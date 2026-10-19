// RomM Mate - main screen (the only screen).
//
// Layout (romfs/xml/main.xml, inflated in the constructor):
//
//   <brls:Box>            this view, column
//     <brls:Header>       "RomM" + the instance URL we talk to
//     <brls:Label>        connection / library status line
//     <brls:ScrollingFrame>
//       <brls:Box>        one row per game: cover + title + platform
//
// The grid rows are built programmatically (makeRow) because their content
// comes from the RomM API; everything else is declarative XML.

// Angle-bracket include on purpose: a quoted #include "MainView.hpp" would
// resolve to src/MainView.hpp (the directory of the current file is searched
// first for quoted includes), which does not match the contract header in
// include/. -Iinclude (see Makefile) makes <MainView.hpp> unambiguous.
#include <MainView.hpp>
#include <borealis.hpp>

#include <string>
#include <utility>
#include <vector>

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

MainView::MainView(std::shared_ptr<RommClient> client) :
    brls::Box(brls::Axis::COLUMN),
    client(std::move(client))
{
    // 1. Inflate the declarative layout from RomFS (BRLS_RESOURCES + name,
    //    i.e. "romfs:/xml/main.xml").
    //
    //    MUST run before touching any BRLS_BIND member: bindings resolve
    //    lazily by id on first use and throw ViewNotFoundException if the
    //    child does not exist yet.
    this->inflateFromXMLRes("xml/main.xml");

    // 2. Header: app name + the RomM instance we will talk to.
    this->header->setTitle("RomM");
    this->header->setSubtitle(this->client ? this->client->baseUrl() : std::string());

    // 3. Status line.
    this->status->setText("Loading…");

    // 4. Null-client guard: the create() factory passes nullptr, so a
    //    client-less instance must degrade gracefully, not crash.
    if (!this->client)
    {
        this->status->setText("No RomM client configured");
        return;
    }

    // 5-7. Fetch the library. Synchronous by design: the new Borealis does
    //      not ship a general background-task primitive, and the constructor
    //      runs before the main loop, so blocking here is safe.
    this->status->setText("Connecting to " + this->client->baseUrl() + " …");
    brls::Logger::info("Authenticating against {}", this->client->baseUrl());

    bool ok = this->client->authenticate();

    if (ok)
    {
        this->games = this->client->getGames();
        this->status->setText(std::to_string(this->games.size()) + " games loaded");
        brls::Logger::info("Loaded {} game(s) from {}", this->games.size(), this->client->baseUrl());
    }
    else
    {
        std::string message;
        this->client->lastError(message);
        this->status->setText("Connect failed: " + message);
        brls::Logger::error("Connection to {} failed: {}", this->client->baseUrl(), message);
        brls::Application::notify("Could not reach RomM");
    }

    // 8. Build the list (no-op for an empty library).
    this->populateGrid();
}

brls::View* MainView::create()
{
    // Factory signature required by Borealis (used if the view is referenced
    // from XML). main.cpp constructs the real instance with a live client,
    // so this just yields a "no client" view, which the constructor above
    // handles gracefully.
    return new MainView(nullptr);
}

// ---------------------------------------------------------------------------
// Game grid
// ---------------------------------------------------------------------------

void MainView::populateGrid()
{
    // Remove the previously built rows. Box::removeView() unlinks the view
    // from the yoga tree and deletes it.
    //
    // Peel them off from the front one at a time: the range-for idiom
    // `for (auto* c : getChildren()) removeView(c);` skips alternating
    // elements, because removeView() shrinks the very vector being iterated.
    auto& children = this->grid->getChildren();
    while (!children.empty())
        this->grid->removeView(children.front());

    // Rebuild one row per game.
    for (const RommGame& game : this->games)
        this->grid->addView(this->makeRow(game));
}

brls::View* MainView::makeRow(const RommGame& game)
{
    // Row: [ 80x112 cover | title (24) / platform (16) ]
    auto* row = new brls::Box(brls::Axis::ROW);
    row->setWidthPercentage(100.0f); // full width of the grid
    row->setFocusable(true);
    row->setCornerRadius(8.0f);
    row->setMarginBottom(8.0f); // small gap between rows

    // Cover image. Placeholder for now; real per-game covers (RomM asset URL
    // -> SD cache -> setImageFromFile) are a next step.
    auto* img = new brls::Image();
    img->setDimensions(80.0f, 112.0f);
    img->setScalingType(brls::ImageScalingType::FIT);
    img->setImageFromRes("posters/default_poster.png");
    img->setMarginRight(16.0f);

    // Text column: title + platform. Takes the remaining horizontal space so
    // long titles truncate (with "…") instead of overflowing the row.
    auto* text = new brls::Box(brls::Axis::COLUMN);
    text->setGrow(1.0f);

    auto* title = new brls::Label();
    title->setText(game.name);
    title->setFontSize(24.0f);
    title->setSingleLine(true);

    auto* platform = new brls::Label();
    platform->setText(game.platform);
    platform->setFontSize(16.0f);

    text->addView(title);
    text->addView(platform);

    row->addView(img);
    row->addView(text);

    // A button: open the game (stub until the detail screen exists).
    row->registerClickAction([this](brls::View* view) {
        return this->onOpenGame(view);
    });

    // X button: details (stub), shown in the bottom-right hint bar.
    row->registerAction(
        "Details", brls::ControllerButton::BUTTON_X, [this](brls::View* /*view*/) {
            brls::Logger::info("X (details, stub)");
            return true;
        });

    return row;
}

bool MainView::onOpenGame(brls::View* /*view*/)
{
    brls::Logger::info("Open game (stub)");
    return true; // event consumed
}
