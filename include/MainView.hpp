#pragma once

#include <borealis.hpp>
#include <memory>
#include <vector>

#include "RommClient.hpp"

// The main (and only) screen: a scrollable, focusable list of game
// cover art + titles, populated from the RomM library.
//
// The XML root is a <brls:Box>; child views are bound via BRLS_BIND.
class MainView : public brls::Box {
public:
    explicit MainView(std::shared_ptr<RommClient> client);

    // Factory method (required if this view is referenced from XML).
    static brls::View* create();

private:
    // Binds the XML ids defined in romfs/xml/main.xml.
    BRLS_BIND(brls::Header,         header,   "header");
    BRLS_BIND(brls::Label,          status,   "status");
    BRLS_BIND(brls::ScrollingFrame, scroller, "scroller");
    BRLS_BIND(brls::Box,            grid,     "grid");

    std::shared_ptr<RommClient> client;
    std::vector<RommGame>       games;

    void        populateGrid();
    brls::View* makeRow(const RommGame& game);
    bool        onOpenGame(brls::View* view);
};

// Minimal brls::Activity wrapper. The wiliwili-rewrite Borealis only accepts
// Activities on its stack (Application::pushActivity), so the MainView box is
// wrapped: createContentView() is invoked synchronously inside pushActivity(),
// which keeps the constructor's (deliberately synchronous) RomM fetch running
// before the main loop starts, exactly as designed.
class MainViewActivity : public brls::Activity {
public:
    explicit MainViewActivity(std::shared_ptr<RommClient> client) :
        client(std::move(client))
    {
    }

    brls::View* createContentView() override { return new MainView(this->client); }

private:
    std::shared_ptr<RommClient> client;
};
