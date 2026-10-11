import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY, parseQuery, serializeQuery, type SearchQuery } from "../src/shared/query.ts";
import { bayesRating, SearchIndex } from "../src/server/search.ts";
import type { Game } from "../src/shared/types.ts";

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

describe("query params", () => {
  it("round-trips through the URL", () => {
    const q: SearchQuery = { ...DEFAULT_QUERY, q: "rogue", tags: ["Roguelike"], notTags: ["Anime"], maxPrice: 20, deck: 3, sort: "rating", page: 3 };
    expect(parseQuery(serializeQuery(q))).toEqual(q);
  });

  it("omits defaults so URLs stay short", () => {
    expect(serializeQuery(DEFAULT_QUERY).toString()).toBe("");
  });
});
