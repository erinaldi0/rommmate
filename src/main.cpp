#include <switch.h>
#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <borealis.hpp>

#include <fstream>
#include <memory>

#include "RommClient.hpp"
#include "MainView.hpp"

// Compile-time fallbacks, used when /switch/rommate/config.json is missing or invalid.
#define DEFAULT_BASE_URL "http://192.168.1.50:11700"
#define DEFAULT_TOKEN    "rmm_...e_me"

struct Config {
    std::string baseUrl;
    std::string token;
};

Config loadConfig() {
    Config cfg{DEFAULT_BASE_URL, DEFAULT_TOKEN};

    std::ifstream f("/switch/rommate/config.json");
    if (f.is_open()) {
        auto json = nlohmann::json::parse(f, nullptr, false);
        if (!json.is_discarded()) {
            if (json.contains("baseUrl") && json["baseUrl"].is_string()) {
                cfg.baseUrl = json["baseUrl"].get<std::string>();
            }
            if (json.contains("token") && json["token"].is_string()) {
                cfg.token = json["token"].get<std::string>();
            }
        } else {
            brls::Logger::warning("config.json is not valid JSON; falling back to defaults");
        }
    }
    return cfg;
}

int main() {
    // 1. Services. (libnx >= 4.10: Init -> Initialize, acm was removed)
    romfsInit();
    hidInitialize();

    // 2. Networking (libcurl; its TLS backend is libnx itself).
    curl_global_init(CURL_GLOBAL_ALL);

    // 3. Borealis.
    brls::Logger::setLogLevel(brls::LogLevel::INFO);

    if (!brls::Application::init()) {
        brls::Logger::error("brls::Application::init() failed");
        curl_global_cleanup();
        hidExit();
        romfsExit();
        return EXIT_FAILURE;
    }

    // 4. Window + START = quit.
    brls::Application::createWindow("RomM");
    brls::Application::setGlobalQuit(true);

    // 5. App-specific content.
    auto cfg    = loadConfig();
    auto client = std::make_shared<RommClient>(cfg.baseUrl, cfg.token);

    brls::Application::pushActivity(new MainViewActivity(client), brls::TransitionAnimation::FADE);

    // 6. Run until the user quits.
    while (brls::Application::mainLoop()) {
    }

    // 7. Teardown.
    curl_global_cleanup();
    hidExit();
    romfsExit();

    return EXIT_SUCCESS;
}
