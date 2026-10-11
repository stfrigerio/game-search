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
- Filters for review score and count, price range, on sale, free, release years, upcoming,
  early access, Windows/macOS/Linux, Steam Deck compatibility and store.
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

Needs Node 20+.

```sh
npm install
npm run crawl   # build the catalogue (~2 minutes, written to data/catalog.json.gz)
npm run dev     # API on :3001, UI on http://localhost:5173
```

You can skip `npm run crawl`: the server crawls on first start if there's no catalogue,
and re-crawls in the background every 24 hours. Search works on the old data meanwhile.

Production:

```sh
npm run build && npm start   # serves the UI and API on http://localhost:3001
```

Or with Docker:

```sh
docker build -t game-search .
docker run -p 3001:3001 -v game-search-data:/app/data game-search
```

The server holds the whole catalogue in memory and uses about 700 MB of RAM once
loaded. Peaks during a re-crawl are higher.

### Configuration

| Env var          | Default                | Meaning                                                   |
| ---------------- | ---------------------- | --------------------------------------------------------- |
| `PORT`           | `3001`                 | API/server port                                           |
| `STORE_COUNTRY`  | `US`                   | Region for Steam/GOG prices                               |
| `STORE_CURRENCY` | `USD`                  | Currency for that region (GOG needs it spelled out)       |
| `REFRESH_HOURS`  | `24`                   | Re-crawl interval                                         |
| `DATA_FILE`      | `data/catalog.json.gz` | Where the catalogue snapshot is stored                    |
| `CRAWL_LIMIT`    | unset                  | Cap games per store, for fast local experiments (`5000`)  |

E.g. `STORE_COUNTRY=IT STORE_CURRENCY=EUR npm run crawl` for Italian euro prices.
CheapShark comparison prices are always in USD.

## How it works

```
src/
  shared/          types + search-query <-> URL params (used by client and server)
  server/
    sources/       one crawler per store; add new stores here
      steam.ts     Steam's store query API (no API key needed)
      gog.ts       GOG's catalogue API (no API key needed)
    merge.ts       folds the same game from different stores into one entry
    search.ts      in-memory index: MiniSearch for text, then filters, sort, facets
    catalog.ts     crawl → merge → index, snapshot to disk, periodic refresh
    prices.ts      CheapShark live prices + reseller/tracker links (edit the list here)
    steam-profile.ts  Steam profile → SteamID64 → public wishlist
    index.ts       Express API (below)
  client/          React UI (Vite)
```

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

## Development

```sh
npm test          # vitest
npm run typecheck
```
