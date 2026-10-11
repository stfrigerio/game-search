import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY, parseQuery, serializeQuery, type SearchQuery } from "../src/shared/query.ts";
import { bayesRating, SearchIndex } from "../src/server/search.ts";
import type { Game } from "../src/shared/types.ts";
import { saleEnds } from "../src/client/format.ts";

let n = 0;
function game(name: string, opts: { tags?: string[]; reviews?: [number, number]; price?: number; year?: number; dev?: string } = {}): Game {
  const [count, pct] = opts.reviews ?? [0, 0];
  const id = ++n;
  return {
    id: `steam:${id}`,
    name,
    developers: opts.dev ? [opts.dev] : [],
    publishers: [],
    tags: opts.tags ?? [],
    description: "",
    image: null,
    releaseDate: opts.year ? Date.UTC(opts.year, 5, 1) / 1000 : null,
    comingSoon: false,
    earlyAccess: false,
    platforms: { windows: true, mac: false, linux: false },
    deck: 0,
    steamAppId: id,
    stores: [
      {
        store: "steam",
        storeGameId: String(id),
        url: "",
        price: opts.price ?? 999,
        basePrice: opts.price ?? 999,
        discountPct: 0,
        free: opts.price === 0,
        reviewCount: count,
        reviewPct: pct,
      },
    ],
  };
}

const index = new SearchIndex([
  game("Portal 2", { tags: ["Puzzle", "Co-op"], reviews: [390_000, 98], price: 999, year: 2011, dev: "Valve" }),
  game("Portal Knights", { tags: ["RPG", "Co-op"], reviews: [17_000, 83], price: 1999, year: 2017 }),
  game("Portal", { tags: ["Puzzle"], reviews: [170_000, 98], price: 999, year: 2007, dev: "Valve" }),
  game("Puzzle Clone", { tags: ["Puzzle", "Anime"], reviews: [3, 100], price: 99, year: 2023 }),
  game("Free Shooter", { tags: ["FPS"], reviews: [5000, 60], price: 0, year: 2020 }),
]);
const search = (q: Partial<SearchQuery>) => index.search({ ...DEFAULT_QUERY, ...q }).results.map((r) => r.name);

describe("SearchIndex", () => {
  it("ranks an exact title match first", () => {
    expect(search({ q: "portal" })[0]).toBe("Portal");
  });

  it("tolerates typos", () => {
    expect(search({ q: "portl knights" })).toContain("Portal Knights");
  });

  it("treats a query that is a tag name as a tag search ranked by popularity", () => {
    const names = search({ q: "puzzle" });
    expect(names.sort()).toEqual(["Portal", "Portal 2", "Puzzle Clone"]);
    expect(search({ q: "puzzle" })[0]).toBe("Portal 2");
  });

  it("finds games by developer", () => {
    expect(search({ q: "valve" }).sort()).toEqual(["Portal", "Portal 2"]);
  });

  it("filters by included and excluded tags, case-insensitively", () => {
    expect(search({ tags: ["puzzle"], notTags: ["anime"], sort: "name" })).toEqual(["Portal", "Portal 2"]);
  });

  it("sorts by rating without letting tiny review counts win", () => {
    expect(search({ sort: "rating" })[0]).toBe("Portal 2");
    expect(bayesRating(100, 3)).toBeLessThan(bayesRating(98, 390_000));
  });

  it("applies price, year and free filters", () => {
    expect(search({ maxPrice: 10, free: "exclude", sort: "name" })).toEqual(["Portal", "Portal 2", "Puzzle Clone"]);
    expect(search({ free: "only" })).toEqual(["Free Shooter"]);
    expect(search({ minYear: 2015, maxYear: 2020, sort: "oldest" })).toEqual(["Portal Knights", "Free Shooter"]);
  });

  it("returns tag facets for the whole match set", () => {
    const res = index.search({ ...DEFAULT_QUERY, q: "portal" });
    expect(res.tagFacets.find((f) => f.tag === "Co-op")?.count).toBe(2);
  });

  it("paginates", () => {
    const res = index.search({ ...DEFAULT_QUERY, page: 2 }, 2);
    expect(res.total).toBe(5);
    expect(res.results).toHaveLength(2);
  });
});

describe("discovery features", () => {
  const disc = (pct: number) => (g: Game) => {
    g.stores[0].discountPct = pct;
    return g;
  };
  const idx = new SearchIndex([
    game("Deckbuilder A", { tags: ["Roguelike Deckbuilder", "Card Game", "Indie"], reviews: [50_000, 97] }),
    game("Deckbuilder B", { tags: ["Card Game", "Roguelike Deckbuilder", "Indie"], reviews: [20_000, 95] }),
    game("Shooter", { tags: ["FPS", "Indie"], reviews: [90_000, 96] }),
    game("Card Thing", { tags: ["Card Game", "Indie"], reviews: [400, 99] }),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => game(`Filler ${k}`, { tags: ["Indie", "Casual"], reviews: [100, 70] })),
  ]);
  const ids = idx.games.map((g) => g.id);

  it("finds similar games by shared distinctive tags", () => {
    const names = idx.similar(ids[0]).map((g) => g.name);
    expect(names[0]).toBe("Deckbuilder B");
    expect(names).not.toContain("Deckbuilder A");
    expect(names).not.toContain("Shooter");
  });

  it("ranks deals by discount weighted by rating", () => {
    const deals = new SearchIndex([
      disc(90)(game("Bad but cheap", { reviews: [1000, 40] })),
      disc(50)(game("Great half off", { reviews: [1000, 97] })),
      disc(0)(game("Full price", { reviews: [1000, 99] })),
    ]);
    const names = deals.search({ ...DEFAULT_QUERY, sort: "deal" }).results.map((r) => r.name);
    expect(names[0]).toBe("Great half off");
  });

  it("caps review counts for hidden gems", () => {
    const names = idx.search({ ...DEFAULT_QUERY, minPct: 90, maxReviews: 1000 }).results.map((r) => r.name);
    expect(names).toEqual(["Card Thing"]);
  });

  it("restricts a search to a list of ids", () => {
    const res = idx.search({ ...DEFAULT_QUERY, sort: "name" }, 30, [ids[2], ids[0], "steam:does-not-exist"]);
    expect(res.results.map((r) => r.name)).toEqual(["Deckbuilder A", "Shooter"]);
  });
});

describe("saleEnds", () => {
  const now = Date.UTC(2026, 9, 11, 12);
  const at = (days: number) => Math.floor((now + days * 86_400_000) / 1000);
  it("phrases the time left", () => {
    expect(saleEnds(at(0.2), now)).toBe("Sale ends today");
    expect(saleEnds(at(1.5), now)).toBe("Sale ends tomorrow");
    expect(saleEnds(at(3.5), now)).toBe("Sale ends in 3 days");
    expect(saleEnds(at(-1), now)).toBeNull();
    expect(saleEnds(null, now)).toBeNull();
  });
});

describe("query params", () => {
  it("round-trips through the URL", () => {
    const q: SearchQuery = { ...DEFAULT_QUERY, q: "rogue", tags: ["Roguelike"], notTags: ["Anime"], maxPrice: 20, deck: 3, sort: "rating", page: 3 };
    expect(parseQuery(serializeQuery(q))).toEqual(q);
  });

  it("omits defaults so URLs stay short", () => {
    expect(serializeQuery(DEFAULT_QUERY).toString()).toBe("");
  });
});
