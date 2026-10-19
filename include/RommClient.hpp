#pragma once

#include <string>
#include <vector>

// A single game / ROM entry returned by the RomM API.
struct RommGame {
    int         id       = 0;
    std::string name;
    std::string platform;   // e.g. "Nintendo 64"
    std::string coverUrl;   // absolute URL to cover art, or "" if none
};

// Thin wrapper over the RomM REST API using libcurl + nlohmann/json.
// Authenticates with a long-lived RomM Client API Token (rmm_...), sent as
// `Authorization: Bearer <token>` on every request.
//
// All network calls are blocking. Call these from a non-rendering context
// (e.g. the view constructor) — the new Borealis does not ship a general
// background-task primitive in this version.
class RommClient {
public:
    RommClient(std::string baseUrl, std::string token);

    // Validate the token with a lightweight authenticated GET (/api/library).
    // Returns true on success; on failure, sets an inspectable error message.
    bool authenticate();

    // Fetch the user's game/ROM list. Returns an empty vector on failure.
    std::vector<RommGame> getGames();

    const std::string& baseUrl() const { return this->serverUrl; }

    // Returns true (and fills `message`) if the last operation failed.
    bool lastError(std::string& message) const {
        message = this->lastErr;
        return !this->lastErr.empty();
    }

private:
    std::string serverUrl;
    std::string token;
    std::string lastErr;

    // Perform an authenticated GET. Fills `body` and `httpCode`.
    // Returns transport-level success (false on a network/SSL error).
    bool performGet(const std::string& path, std::string& body, long& httpCode);

    // Resolve a (possibly relative) RomM asset path to an absolute URL.
    std::string absUrl(const std::string& maybeRelative) const;
};
