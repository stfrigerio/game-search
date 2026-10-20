import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCompare } from "../src/server/compare.ts";
import { buildInsights, buildLibrary, type CatalogRow } from "../src/server/library.ts";
import { summarize } from "../src/server/derive.ts";
import { gamePage, renderPage } from "../src/server/pages.ts";
import type { OwnedGame } from "../src/server/steam-profile.ts";
import { gameIdFromSlug, gamePath } from "../src/shared/slug.ts";
import type { LibraryResponse } from "../src/shared/types.ts";
import { persona, profileHandle, wrappedSlides } from "../src/shared/wrapped.ts";
import { game } from "./fixtures.ts";

const ONLINE_COOP = 1 << 3; // FEATURES[3] is "onlineCoop"

function row(appid: number, tags: string[], features = 0, price = 1999): CatalogRow {
  return {
    steam_app_id: appid,
    id: `steam:${appid}`,
    name: `Game ${appid}`,
    image: null,
    free: false,
    best_price: price,
    best_base_price: price,
    best_discount: 0,
    tags,
    release_date: null,
    rating: 80,
    review_pct: 90,
    review_count: 1000,
    features,
  };
}

function library(owned: OwnedGame[], rows: CatalogRow[], steamId = "76561197960287930", vanity?: string): LibraryResponse {
  const lib = buildLibrary(owned, new Map(rows.map((r) => [r.steam_app_id, r])));
  return {
    steamId,
    profile: {
      name: "Tester",
      avatar: null,
      profileUrl: vanity ? `https://steamcommunity.com/id/${vanity}/` : `https://steamcommunity.com/profiles/${steamId}/`,
      country: null,
      memberSince: null,
      level: null,
      badges: null,
      friends: null,
    },
    currency: "USD",
    ...lib,
    insights: buildInsights(lib.games),
  };
}

const catalog = [
  row(1, ["Roguelike", "Action"], ONLINE_COOP),
  row(2, ["Strategy", "4X"]),
  row(3, ["Puzzle"], ONLINE_COOP, 999),
  row(4, ["Roguelike"]),
];

describe("persona", () => {
  it("calls a library mostly unplayed a collection", () => {
    const owned = Array.from({ length: 50 }, (_, i) => ({ appid: 100 + i, playtime_forever: i < 10 ? 60 : 0 }));
    expect(persona(library(owned, [])).key).toBe("collector");
  });

  it("calls one dominant game devotion, and otherwise reads the top tags", () => {
    expect(persona(library([{ appid: 1, playtime_forever: 6000 }, { appid: 2, playtime_forever: 600 }], catalog)).key).toBe("devotee");
    const spread = [
      { appid: 1, playtime_forever: 3000 },
      { appid: 4, playtime_forever: 2800 },
      { appid: 2, playtime_forever: 1000 },
    ];
    expect(persona(library(spread, catalog)).key).toBe("runner");
  });
});

describe("wrappedSlides", () => {
  it("tells the story and leaves out slides with nothing to say", () => {
    const lib = library(
      [
        { appid: 1, playtime_forever: 3000 },
        { appid: 2, playtime_forever: 1200 },
        { appid: 3, playtime_forever: 0 },
      ],
      catalog,
    );
    const slides = wrappedSlides(lib);
    expect(slides.map((s) => s.key)).toEqual(["intro", "top", "taste", "value", "shame", "persona", "worth"]);
    expect(slides[0].big).toBe("70 h");
    // $19.99 over 50 hours is the cheapest per hour.
    expect(slides.find((s) => s.key === "value")).toMatchObject({ big: "$0.40/h", appId: 1 });
    // Nothing unplayed: no pile of shame.
    expect(wrappedSlides(library([{ appid: 1, playtime_forever: 60 }], catalog)).map((s) => s.key)).not.toContain("shame");
  });
});

describe("profileHandle", () => {
  it("prefers the custom URL name", () => {
    expect(profileHandle(library([], [], "76561197960287930", "gaben"))).toBe("gaben");
    expect(profileHandle(library([], []))).toBe("76561197960287930");
  });
});

describe("buildCompare", () => {
  it("finds shared games, what to play together and what to recommend", () => {
    const a = library(
      [
        { appid: 1, playtime_forever: 900 },
        { appid: 2, playtime_forever: 1200 },
        { appid: 3, playtime_forever: 0 },
      ],
      catalog,
    );
    const b = library(
      [
        { appid: 1, playtime_forever: 300 },
        { appid: 3, playtime_forever: 60 },
        { appid: 4, playtime_forever: 700 },
      ],
      catalog,
      "76561197960287931",
    );
    const c = buildCompare(a, b);
    expect(c.common).toBe(2);
    expect(c.together.map((g) => g.appId)).toEqual([1, 3]);
    expect(c.bothPlayed.map((g) => g.appId)).toEqual([1]);
    expect(c.aRecommends).toEqual([expect.objectContaining({ appId: 2, owned: false })]);
    expect(c.bRecommends).toEqual([expect.objectContaining({ appId: 4, owned: false })]);
    expect(c.tasteMatch).toBeGreaterThan(0);
    expect(c.tasteMatch).toBeLessThan(1);
    expect(buildCompare(a, a).tasteMatch).toBeCloseTo(1);
  });
});

describe("game slugs", () => {
  it("round-trips ids through readable paths", () => {
    expect(gamePath("steam:620", "Portal 2")).toBe("/game/steam-620-portal-2");
    expect(gamePath("gog:1207658924", "Pokémon? No: Fallout™ 2")).toBe("/game/gog-1207658924-pokemon-no-fallout-2");
    expect(gameIdFromSlug("steam-620-portal-2")).toBe("steam:620");
    expect(gameIdFromSlug("gog-42")).toBe("gog:42");
    expect(gameIdFromSlug("epic-1")).toBeNull();
    expect(gameIdFromSlug("steam-620x")).toBeNull();
  });
});

describe("renderPage", () => {
  it("writes the page's own meta and escapes what came from outside", () => {
    const dir = mkdtempSync(join(tmpdir(), "page-"));
    const index = join(dir, "index.html");
    writeFileSync(
      index,
      `<html><head><title>Site</title><link rel="canonical" href="https://x/" /><meta name="description" content="d" /><meta property="og:title" content="t" /></head><body><div id="root"></div></body></html>`,
    );
    const html = renderPage(index, {
      title: `Evil "game" <script>`,
      description: "A $& b",
      url: "https://x/game/steam-1",
      image: "https://img/1.jpg",
      body: "<h1>Hi</h1>",
      jsonLd: { name: "</script><script>alert(1)</script>" },
    });
    expect(html).toContain("<title>Evil &quot;game&quot; &lt;script&gt;</title>");
    expect(html).toContain('<meta name="description" content="A $&amp; b" />');
    expect(html).toContain('<link rel="canonical" href="https://x/game/steam-1" />');
    expect(html).toContain('<meta property="og:image" content="https://img/1.jpg" />');
    expect(html).toContain('<div id="root"><h1>Hi</h1></div>');
    expect(html).not.toContain("</script><script>alert");
  });
});

describe("gamePage", () => {
  const hades = game("Hades <II>", { tags: ["Roguelike", "Action"], reviews: [5000, 96], price: 1499, discount: 40, year: 2020, dev: "Supergiant", categories: [2, 22], players: 30000 });
  const detail = { game: hades, summary: { ...summarize(hades), power: 2 as const, powerKnown: true }, features: ["single", "achievements"], languages: [], specs: null };
  const similar = [summarize(game("Dead Cells"))];

  it("writes what a searcher wants to know as crawlable text, with links to similar games", () => {
    const { body, jsonLd } = gamePage({ detail, similar, prices: null, currency: "USD" }, "https://x");
    expect(body).toContain("<h1>Hades &lt;II&gt;</h1>");
    expect(body).toContain("Where to buy Hades &lt;II&gt; cheapest");
    expect(body).toContain("$14.99 (40% off $24.98)");
    expect(body).toContain("Can my PC run Hades &lt;II&gt;?");
    expect(body).toContain("96% of 5,000 reviews positive");
    expect(body).toContain("30,000 players");
    expect(body).toContain("Achievements");
    expect(body).toMatch(/<a href="\/game\/steam-\d+-dead-cells">Dead Cells<\/a>/);
    expect(jsonLd).toMatchObject({ offers: { lowPrice: "14.99", priceCurrency: "USD", offerCount: 1 } });
  });

  it("prefers recently looked-up shop prices and shows the historic low", () => {
    const prices = {
      currency: "USD",
      offers: [
        { shop: "Fanatical", price: 999, basePrice: 2499, discountPct: 60, url: "https://f", kind: "official" as const },
        { shop: "G2A", price: 500, basePrice: 500, discountPct: 0, url: "https://g", kind: "keyshop" as const },
      ],
      links: [],
      historicLow: 799,
      error: null,
    };
    const { body, jsonLd } = gamePage({ detail, similar: [], prices, currency: "USD" }, "https://x");
    expect(body).toContain("Fanatical</a>: $9.99");
    expect(body).not.toContain("G2A");
    expect(body).toContain("Historic low: $7.99");
    expect(body).not.toContain("Games like");
    expect(jsonLd).toMatchObject({ offers: { lowPrice: "9.99" } });
  });
});
