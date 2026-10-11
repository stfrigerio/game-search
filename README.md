# Game Search

A faster, more useful search across PC game stores than the one built into Steam.
It merges ~195k games from **Steam** and **GOG** into one index and compares prices
across official stores and key resellers (G2A, Kinguin, Eneba, Instant Gaming, …).

## What it does better than Steam search

**Find games**
- **Typo-tolerant search** over titles, developers and publishers ("hollow knigth", "valve").
  Typing a tag name ("roguelike", "co-op") offers to filter by that tag instead.
- **Include and exclude tags**, e.g. *Roguelike Deckbuilder* but not *Anime*. Tag facets
  show what's in your current results, so you can narrow down with one click (right-click
  a facet to exclude it).
- **"Best rated" sorting that accounts for review count** ([SteamDB's formula](https://steamdb.info/blog/steamdb-rating/)),
  so a 100% game with 3 reviews doesn't beat a 97% game with 300k.
- **"Best deals" sorting**: discount weighted by quality, so 50% off a great game beats
  90% off a bad one.
- **Lots of filters, each with live counts** of how many results have it:
  - **Reviews**: % positive and number of reviews (min and max, for hidden gems)
  - **Computer needed**: light, medium or demanding, from each game's minimum system
    requirements (see [below](#computer-needed-light--medium--demanding))
  - **Players**: how many are playing now (Steam peak yesterday, via SteamSpy) and game
    modes: single-player, multiplayer, co-op, online / local split-screen / LAN co-op,
    PvP, MMO, cross-platform, Remote Play Together
  - **Price**: range, on sale, minimum discount, free / not free
  - **Release**: last 30 days … 5 years, year range, upcoming, early access
  - **Platform & controls**: Windows/macOS/Linux, Steam Deck, full/any controller
    support, VR
  - **Language**: interface/subtitles or full audio in any of Steam's 30 languages
  - **Features**: achievements, cloud saves, Workshop mods, trading cards, level editor,
    Family Sharing, HDR, and *no in-app purchases*
  - **Accessibility**: adjustable difficulty, save anytime, subtitle options,
    colour-blind modes, no timed input, keyboard-only, text size
  - **Hide content**: porn (games Steam marks adult-only, or with Hentai / NSFW among their
    top five tags), any sexual content, gore, general mature content. The front-page
    shelves and the capsule machine always leave porn out.
  - Store and developer/publisher (click a developer name)
  - Every feature can be required or excluded; active filters show as removable chips,
    and common ones are one tap away (Co-op, On sale, Deck Verified, Popular now, …).
- Sort by relevance, rating, most reviewed, **most played now**, newest, price, best
  deal or biggest discount.
- **Similar games** on every game page, from shared *distinctive* tags (sharing
  "Metroidvania" counts, sharing "Indie" barely does) and rating.
- A **Discover** page with shelves: best deals right now, hidden gems (95%+ but under
  1,000 reviews), best of the past year, great Deck games under $10, free games worth
  playing, DRM-free GOG classics.

**Pay less**
- **One entry per game across stores**: games sold on both Steam and GOG show both
  listings, prices and review scores.
- **Price comparison** on each game: live prices from official stores via
  [CheapShark](https://www.cheapshark.com/) (Steam, GOG, Humble, Fanatical, GMG,
  GamesPlanet, GameBillet, …), the historic low, when the sale ends, and links to key
  resellers (G2A, Kinguin, Eneba, Instant Gaming, …) and price trackers.
- **My list**: star any game, or **import your Steam wishlist** (profile URL, custom URL
  name or SteamID64; the wishlist must be public). The list shows the cheapest price
  anywhere for each game, flags when it's cheaper outside Steam or at its historic low,
  and supports every filter and sort ("on sale, sorted by best deal").
  The list is stored in your browser; there are no accounts.
- Every search is in the URL, so you can bookmark or share it.

## Running it

Needs Node 20+ and PostgreSQL 13+ with the `pg_trgm` extension (part of the standard
`postgresql-contrib` package).

```sh
# once, as a Postgres superuser
createuser -P game_search
createdb -O game_search game_search
psql -d game_search -c 'CREATE EXTENSION pg_trgm'

export DATABASE_URL=postgres://game_search:<password>@localhost/game_search
npm install
npm run migrate   # create the tables
npm run crawl     # build the catalogue: ~8 minutes, ~500 MB of RAM at peak
npm run dev       # API on :3001, UI on http://localhost:5173
```

Production:

```sh
npm run build     # front-end into dist/, server into dist-server/
npm start         # serves the UI and API on http://localhost:3001
```

The web server keeps nothing in memory but a small cache (~100 MB RSS). The catalogue
is rebuilt by a separate nightly job, `node dist-server/crawl-cli.js`; see
[deploy/DEPLOY.md](deploy/DEPLOY.md) for the systemd service and timer.
`npm run crawl -- --players` refreshes only the SteamSpy player counts.

### Configuration

| Env var          | Default | Meaning                                                   |
| ---------------- | ------- | --------------------------------------------------------- |
| `DATABASE_URL`   | —       | Postgres connection string (required)                     |
| `PORT`           | `3001`  | API/server port                                           |
| `HOST`           | all     | Interface to listen on, e.g. `127.0.0.1` behind a proxy   |
| `STORE_COUNTRY`  | `US`    | Region for Steam/GOG prices (crawler)                     |
| `STORE_CURRENCY` | `USD`   | Currency for that region; GOG needs it spelled out        |
| `CRAWL_LIMIT`    | unset   | Cap games per store, for fast local experiments (`5000`)  |
| `SKIP_STEAMSPY`  | unset   | `1` skips the ~5 min SteamSpy player-count crawl          |
| `SPECS_PAUSE_MS` | `1600`  | Pause between system-requirement requests; `0` turns them off |
| `DB_POOL_SIZE`   | `6`     | Max Postgres connections from the web server              |

E.g. `STORE_COUNTRY=IT STORE_CURRENCY=EUR npm run crawl` for Italian euro prices.
CheapShark comparison prices are always in USD.

## How it works

```
src/
  shared/            types, filter definitions (features.ts) and search-query <-> URL params
  server/
    sources/         one crawler per store; add new stores here
      steam.ts       Steam's store query API (no API key), streamed page by page
      gog.ts         GOG's catalogue API (no API key)
      steamspy.ts    player counts and owner estimates (slow, polite crawl)
    crawler.ts       crawl → staging schema → atomic swap (crawl-cli.ts runs it)
    merge.ts         matches the same game across stores by title
    derive.ts        per-game summary values: rating, best price, feature bitmasks
    db/
      schema.ts      tables and indexes (migrate-cli.ts creates them)
      rows.ts        Game <-> table rows
      search.ts      filters, sorting, text search, counts, similar games as SQL
    prices.ts        CheapShark live prices + reseller/tracker links (edit the list here)
    steam-profile.ts Steam profile → SteamID64 → public wishlist
    index.ts         Express API (below)
  client/            React UI (Vite)
```

**Storage.** Each game is a row in `catalog.games`, a narrow table holding only what
searches filter and sort on (it stays in Postgres' cache), plus `catalog.game_details`
for display data, read only for the games on screen. Player modes, features,
languages and content flags are bitmask columns; tags are an `int[]` with a GIN
index; titles and developer names have trigram indexes for typo-tolerant search.
Everything in the `catalog` schema is rebuilt by each crawl, so it doesn't need
backing up.

**Crawling.** The crawler writes Steam pages to a `catalog_staging` schema as they
arrive, keeping only a small title index in memory to match GOG games against Steam.
At the end it builds the indexes and swaps the schemas in one transaction, so the site
always serves a complete catalogue. If any store fails, the crawl aborts and yesterday's
catalogue stays live; a failed SteamSpy crawl just carries over the previous player
counts. An advisory lock stops two crawls from running at once.

API:

| Endpoint                       | What it returns                                              |
| ------------------------------ | ------------------------------------------------------------ |
| `GET /api/meta`                | catalogue status, store counts, all tags                     |
| `GET /api/search?…`            | one page of results + tag facets (params as in the site URL) |
| `POST /api/search`             | same, restricted to `{ ids }` (used for My list)              |
| `GET /api/games/:id`           | full game record                                             |
| `GET /api/games/:id/prices`    | live offers, historic low, reseller and tracker links        |
| `GET /api/games/:id/similar`   | similar games                                                |
| `POST /api/prices/best`        | cheapest offer for up to 60 `{ ids }`                         |
| `GET /api/steam/wishlist?profile=…` | game ids on a public Steam wishlist                    |

Games are matched across stores by normalised title (case, ™/®, punctuation, `&`/`and`).
A looser match drops edition suffixes ("GOTY", "Enhanced Edition", …) and turns roman
numerals into digits, but it's only used when it points to exactly one game.

**Not included:** Epic's catalogue is behind Cloudflare and can't be crawled, but Epic
deals still show up in the CheapShark price comparison. Console games aren't covered;
adding [IGDB](https://api-docs.igdb.com/) as a source would cover them but needs a Twitch API key.

**About key resellers:** G2A, Kinguin, Eneba and similar sites sell keys on a grey
market. They're often cheaper, but the developer may not be paid and keys are
occasionally revoked. The UI labels them separately from official stores.

### Computer needed (light / medium / demanding)

Every game has a power level, shown as a three-bar meter and filterable with `power=low,mid,high`:

- **Light**: runs on almost anything, integrated graphics included.
- **Medium**: wants a graphics card, an older one will do.
- **Demanding**: wants a recent gaming PC (around a GTX 1060 or better to play properly).

The level comes from the store's **minimum and recommended requirements**. The catalogue
APIs don't carry them, so the web server reads them from Steam's `appdetails` one game at
a time in the background (most reviewed games first, one request every 1.6 s to stay
under Steam's limit of about 200 per five minutes) and keeps them in `public.specs`,
which crawls don't rebuild. Reading all ~190k games takes a few days; the first tens of
thousands, which are the games people actually look for, take one.

`src/server/power.ts` picks the graphics cards out of the free text, scores them on a
scale where a GTX 1060 is 6, and takes the point halfway between the minimum and the
recommended card as what the game really wants. The minimum alone flatters: Divinity:
Original Sin 2 lists a GTX 550 as minimum and a GTX 770 as recommended. Under about a
GTX 650 that is light, from about 4.5 on the scale it is demanding. Just above the light
line a 2D or pre-2012 game still counts as light, because those routinely ask for more
than they use. Memory only nudges; disk space is ignored.

Until a game has been read (and for GOG-only games) the level is an **estimate** from
tags, age and price, drawn with a dashed edge.

## Development

```sh
npm run typecheck
TEST_DATABASE_URL=postgres://game_search:<pw>@localhost/game_search_test npm test
```

Database tests wipe and reload the catalogue in `TEST_DATABASE_URL`, so point it at a
separate database. Without it they're skipped; CI runs them against a Postgres service.
