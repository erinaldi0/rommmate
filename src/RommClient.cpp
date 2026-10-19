// RommClient implementation.
//
// Pure libcurl + nlohmann/json layer, intentionally decoupled from Borealis.
// All requests are authenticated with a RomM "Client API Token" (rmm_...),
// sent as `Authorization: Bearer <token>`; responses are JSON.
//
// Diagnostics go to stderr via std::fprintf (the console's system output)
// and to `lastErr`, which callers can inspect via lastError().

#include "RommClient.hpp"

#include <curl/curl.h>
#include <nlohmann/json.hpp>

#include <cstdio>
#include <string>
#include <utility>
#include <vector>

using json = nlohmann::json;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// libcurl WRITEFUNCTION target: appends the received chunk to a std::string.
static size_t appendToString(char* data, size_t size, size_t nmemb, void* userdata)
{
    if (data == nullptr || userdata == nullptr)
        return 0;

    auto* out = static_cast<std::string*>(userdata);
    out->append(data, size * nmemb);
    return size * nmemb; // signal success to libcurl
}

// Reads one entry of a RomM `assets` object. Asset values come in two
// shapes across RomM versions:
//   "box_2d": "/assets/games/123/abc.png"                      (plain path)
//   "box_2d": { "path": "/assets/games/123/abc.png", ... }     (object)
// Returns the first non-empty path found, or "" if the key is absent or
// none of the shapes yielded a usable string.
static std::string assetPath(const json& assets, const char* key)
{
    if (!assets.is_object())
        return "";

    auto it = assets.find(key);
    if (it == assets.end())
        return "";

    const json& v = *it;

    if (v.is_string())
        return v.get<std::string>();

    if (v.is_object())
    {
        for (const char* member : { "path", "url" })
        {
            auto mt = v.find(member);
            if (mt != v.end() && mt->is_string())
            {
                const std::string s = mt->get<std::string>();
                if (!s.empty())
                    return s;
            }
        }
    }

    return "";
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

RommClient::RommClient(std::string baseUrl, std::string token) :
    serverUrl(std::move(baseUrl)),
    token  (std::move(token))
{
    // Normalise: strip trailing slashes so `baseUrl + path` joining stays
    // simple and we never produce "http://host//api/...".
    while (!this->serverUrl.empty() && this->serverUrl.back() == '/')
        this->serverUrl.pop_back();
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

bool RommClient::authenticate()
{
    this->lastErr.clear();

    // A lightweight authenticated GET. RomM authorises every /api route
    // against the token, so 200 proves the token is valid without needing
    // a heavier endpoint.
    std::string body;
    long httpCode = 0;

    if (!this->performGet("/api/library", body, httpCode))
        return false; // lastErr already set by performGet (transport error)

    if (httpCode == 200)
        return true;

    if (httpCode == 401 || httpCode == 403)
    {
        this->lastErr = "Invalid RomM API token";
        std::fprintf(stderr, "[rommmate] RomM rejected the API token (HTTP %ld)\n", httpCode);
        return false;
    }

    this->lastErr = "HTTP " + std::to_string(httpCode);
    std::fprintf(stderr, "[rommmate] RomM returned HTTP %ld during authentication\n", httpCode);
    return false;
}

// ---------------------------------------------------------------------------
// Game list
// ---------------------------------------------------------------------------

std::vector<RommGame> RommClient::getGames()
{
    this->lastErr.clear();

    std::string body;
    long httpCode = 0;

    // 48 keeps the payload modest; the UI only needs the first screenful.
    if (!this->performGet("/api/roms?_limit=48", body, httpCode))
        return {}; // lastErr set by performGet

    if (httpCode != 200)
    {
        this->lastErr = "HTTP " + std::to_string(httpCode) + " from /api/roms";
        std::fprintf(stderr, "[rommmate] GET /api/roms failed (HTTP %ld)\n", httpCode);
        return {};
    }

    // Non-throwing parse: malformed JSON yields a discarded sentinel instead
    // of an exception (the build has exceptions enabled, but we don't want
    // a malformed response to be fatal).
    json j = json::parse(body, nullptr, false);
    if (j.is_discarded())
    {
        this->lastErr = "Malformed JSON from /api/roms";
        std::fprintf(stderr, "[rommmate] /api/roms returned invalid JSON (%zu bytes)\n",
                     body.size());
        return {};
    }

    // RomM serves the list either as a bare JSON array or wrapped as
    // { "data": [ ... ], "meta": { ... } } depending on the version.
    const json* arr = nullptr;
    if (j.is_array())
    {
        arr = &j;
    }
    else if (j.is_object() && j.contains("data") && j["data"].is_array())
    {
        arr = &j.at("data");
    }

    if (arr == nullptr)
    {
        this->lastErr = "Unexpected JSON shape from /api/roms";
        std::fprintf(stderr, "[rommmate] /api/roms: expected an array or {data: [...]}\n");
        return {};
    }

    std::vector<RommGame> games;
    games.reserve(arr->size());

    for (const auto& entry : *arr)
    {
        // Tolerate garbage entries instead of aborting the whole list.
        if (!entry.is_object())
            continue;

        RommGame game;

        if (entry.contains("id") && entry.at("id").is_number_integer())
            game.id = entry.at("id").get<int>();

        if (entry.contains("name") && entry.at("name").is_string())
            game.name = entry.at("name").get<std::string>();

        // platform is usually { "id": ..., "name": "Nintendo 64" }, but be
        // defensive in case a version flattens or omits it.
        if (entry.contains("platform") && entry.at("platform").is_object())
            game.platform = entry.at("platform").value("name", std::string());

        // Cover art: prefer the 2D box, fall back to a 16:9 screenshot.
        if (entry.contains("assets") && entry.at("assets").is_object())
        {
            const json& assets = entry.at("assets");

            std::string path = assetPath(assets, "box_2d");
            if (path.empty())
                path = assetPath(assets, "screenshot_16x9");

            if (!path.empty())
                game.coverUrl = this->absUrl(path);
        }

        games.push_back(std::move(game));
    }

    return games;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

bool RommClient::performGet(const std::string& path, std::string& body, long& httpCode)
{
    body.clear();
    httpCode = 0;

    const std::string url = this->serverUrl + path;

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, ("Authorization: Bearer " + this->token).c_str());
    headers = curl_slist_append(headers, "Accept: application/json");

    CURL* curl = curl_easy_init();
    if (curl == nullptr)
    {
        this->lastErr = "curl_easy_init() failed";
        std::fprintf(stderr, "[rommmate] curl_easy_init() failed\n");
        curl_slist_free_all(headers);
        return false;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, appendToString);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);

    const CURLcode rc = curl_easy_perform(curl);
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_easy_cleanup(curl);
    curl_slist_free_all(headers);

    if (rc != CURLE_OK)
    {
        this->lastErr = std::string("Request to ") + url + " failed: " +
                         curl_easy_strerror(rc);
        std::fprintf(stderr, "[rommmate] GET %s failed: %s\n", url.c_str(),
                     curl_easy_strerror(rc));
        return false;
    }

    return true;
}

std::string RommClient::absUrl(const std::string& maybeRelative) const
{
    // Empty or already-absolute (http:// or https://) paths pass through.
    if (maybeRelative.empty())
        return "";

    if (maybeRelative.rfind("http", 0) == 0)
        return maybeRelative;

    // Relative path: glue it onto the instance URL. The constructor already
    // stripped trailing slashes from baseUrl, so add one when the path does
    // not lead with '/'.
    return this->serverUrl + (maybeRelative.front() == '/' ? "" : "/") + maybeRelative;
}
