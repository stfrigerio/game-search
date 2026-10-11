// Search tests against a real Postgres. Set TEST_DATABASE_URL to a database you
// don't mind being wiped (with pg_trgm available); without it these are skipped.
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_QUERY, type SearchQuery } from "../src/shared/query.ts";
import type { Game } from "../src/shared/types.ts";
import { game } from "./fixtures.ts";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const { replaceCatalog } = await import("../src/server/crawler.ts");
const { closeDb } = await import("../src/server/db/pool.ts");
const search = await import("../src/server/db/search.ts");
const { bayesRating } = await import("../src/server/derive.ts");

async function load(games: Game[]) {
  await replaceCatalog(games);
  search.resetCatalogCache();
  return games;
}
const run = (q: Partial<SearchQuery>, pageSize?: number, ids?: string[]) =>
  search.searchGames({ ...DEFAULT_QUERY, ...q }, pageSize, ids);
const names = async (q: Partial<SearchQuery>, ids?: string[]) => (await run(q, 30, ids)).results.map((r) => r.name);

afterAll(async () => {
  if (url) await closeDb();
});

describe.skipIf(!url)("search", () => {
  it("loads", async () => {
    await load([
      game("Portal 2", { tags: ["Puzzle", "Co-op"], reviews: [390_000, 98], price: 999, year: 2011, dev: "Valve" }),
      game("Portal Knights", { tags: ["RPG", "Co-op"], reviews: [17_000, 83], price: 1999, year: 2017 }),
      game("Portal", { tags: ["Puzzle"], reviews: [170_000, 98], price: 999, year: 2007, dev: "Valve" }),
      game("Puzzle Clone", { tags: ["Puzzle", "Anime"], reviews: [3, 100], price: 99, year: 2023 }),
      game("Free Shooter", { tags: ["FPS"], reviews: [5000, 60], price: 0, year: 2020 }),
    ]);
    expect((await search.getMeta()).storeCounts).toEqual({ steam: 5 });
  });

  it("ranks an exact title match first", async () => {
    expect((await names({ q: "portal" }))[0]).toBe("Portal");
  });

  it("tolerates typos", async () => {
    expect(await names({ q: "portl knights" })).toContain("Portal Knights");
  });

  it("treats a query that is a tag name as a tag search ranked by popularity", async () => {
    const found = await names({ q: "puzzle" });
    expect([...found].sort()).toEqual(["Portal", "Portal 2", "Puzzle Clone"]);
    expect(found[0]).toBe("Portal 2");
  });

  it("finds games by developer", async () => {
    expect((await names({ q: "valve" })).sort()).toEqual(["Portal", "Portal 2"]);
  });

  it("filters by included and excluded tags, case-insensitively", async () => {
    expect(await names({ tags: ["puzzle"], notTags: ["anime"], sort: "name" })).toEqual(["Portal", "Portal 2"]);
  });

  it("sorts by rating without letting tiny review counts win", async () => {
    expect((await names({ sort: "rating" }))[0]).toBe("Portal 2");
    expect(bayesRating(100, 3)).toBeLessThan(bayesRating(98, 390_000));
  });

  it("applies price, year and free filters", async () => {
    expect(await names({ maxPrice: 10, free: "exclude", sort: "name" })).toEqual(["Portal", "Portal 2", "Puzzle Clone"]);
    expect(await names({ free: "only" })).toEqual(["Free Shooter"]);
    expect(await names({ minYear: 2015, maxYear: 2020, sort: "oldest" })).toEqual(["Portal Knights", "Free Shooter"]);
  });

  it("returns tag facets for the whole match set", async () => {
    const res = await run({ q: "portal" });
    expect(res.tagFacets.find((f) => f.tag === "Co-op")?.count).toBe(2);
  });

  it("paginates", async () => {
    const res = await run({ page: 2 }, 2);
    expect(res.total).toBe(5);
    expect(res.results).toHaveLength(2);
  });
});

describe.skipIf(!url)("discovery", () => {
  let ids: string[] = [];
  it("loads", async () => {
    const games = await load([
      game("Deckbuilder A", { tags: ["Roguelike Deckbuilder", "Card Game", "Indie"], reviews: [50_000, 97] }),
      game("Deckbuilder B", { tags: ["Card Game", "Roguelike Deckbuilder", "Indie"], reviews: [20_000, 95] }),
      game("Shooter", { tags: ["FPS", "Indie"], reviews: [90_000, 96] }),
      game("Card Thing", { tags: ["Card Game", "Indie"], reviews: [400, 99] }),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => game(`Filler ${k}`, { tags: ["Indie", "Casual"], reviews: [100, 70] })),
    ]);
    ids = games.map((g) => g.id);
  });

  it("finds similar games by shared distinctive tags", async () => {
    const found = (await search.similarGames(ids[0])).map((g) => g.name);
    expect(found[0]).toBe("Deckbuilder B");
    expect(found).not.toContain("Deckbuilder A");
    expect(found).not.toContain("Shooter");
  });

  it("caps review counts for hidden gems", async () => {
    expect(await names({ minPct: 90, maxReviews: 1000 })).toEqual(["Card Thing"]);
  });

  it("restricts a search to a list of ids", async () => {
    expect(await names({ sort: "name" }, [ids[2], ids[0], "steam:does-not-exist"])).toEqual(["Deckbuilder A", "Shooter"]);
    expect(await search.existingIds([ids[2], "steam:nope", ids[0]])).toEqual([ids[2], ids[0]]);
  });

  it("ranks deals by discount weighted by rating", async () => {
    await load([
      game("Bad but cheap", { reviews: [1000, 40], discount: 90 }),
      game("Great half off", { reviews: [1000, 97], discount: 50 }),
      game("Full price", { reviews: [1000, 99] }),
    ]);
    expect((await names({ sort: "deal" }))[0]).toBe("Great half off");
  });
});

describe.skipIf(!url)("player modes, features, languages and content", () => {
  let ids: string[] = [];
  it("loads", async () => {
    const games = await load([
      game("Coop Shooter", { categories: [1, 9, 38, 22], languages: [0, 3], audio: [0], players: 50_000, reviews: [9000, 90] }),
      game("Couch Party", { categories: [1, 9, 39, 24, 35], languages: [0], players: 300, reviews: [800, 85], dev: "Party Co" }),
      game("Solo Story", { categories: [2, 22, 28], languages: [0, 3], audio: [0, 3], players: 1200, reviews: [5000, 95], content: [2] }),
      game("Adult VN", { categories: [2], languages: [0], content: [3], reviews: [100, 80] }),
    ]);
    ids = games.map((g) => g.id);
  });

  it("filters by player modes (all must match)", async () => {
    expect(await names({ features: ["coop"], sort: "name" })).toEqual(["Coop Shooter", "Couch Party"]);
    expect(await names({ features: ["coop", "localCoop"] })).toEqual(["Couch Party"]);
    expect(await names({ features: ["single", "controllerFull"] })).toEqual(["Solo Story"]);
  });

  it("excludes features, e.g. no in-app purchases", async () => {
    expect(await names({ features: ["multi"], notFeatures: ["iap"] })).toEqual(["Coop Shooter"]);
  });

  it("filters by language, optionally with full audio", async () => {
    expect(await names({ lang: "it", sort: "name" })).toEqual(["Coop Shooter", "Solo Story"]);
    expect(await names({ lang: "it", audio: true })).toEqual(["Solo Story"]);
  });

  it("hides content", async () => {
    expect(await names({ hide: ["sexual"] })).not.toContain("Adult VN");
    expect(await names({ hide: ["sexual", "gore"], sort: "name" })).toEqual(["Coop Shooter", "Couch Party"]);
  });

  it("filters and sorts by players online", async () => {
    expect(await names({ minPlayers: 1000, sort: "name" })).toEqual(["Coop Shooter", "Solo Story"]);
    expect((await names({ sort: "players" }))[0]).toBe("Coop Shooter");
  });

  it("filters by developer, case-insensitively", async () => {
    expect(await names({ dev: "party co" })).toEqual(["Couch Party"]);
  });

  it("counts how many matches have each feature and language", async () => {
    const res = await run({ features: ["multi"] });
    expect(res.featureCounts.coop).toBe(2);
    expect(res.featureCounts.localCoop).toBe(1);
    expect(res.languageCounts.it).toBe(1);
  });

  it("reports features and languages on the detail record", async () => {
    const d = (await search.getGameDetail(ids[2]))!;
    expect(d.features).toEqual(expect.arrayContaining(["single", "achievements", "controllerFull", "controller"]));
    expect(d.languages).toContainEqual({ code: "it", audio: true });
    expect(d.game.categories).toEqual([2, 22, 28]);
  });
});

describe.skipIf(!url)("computer power", () => {
  const year = new Date().getFullYear();
  let light: Game;
  let heavy: Game;
  let read: Game;
  const specs = { ram: 16, vram: 8, disk: 100, gpu: 11, gpuText: "RTX 3060" };

  it("loads, estimating from tags, age and price", async () => {
    const { db } = await import("../src/server/db/pool.ts");
    await db().query("DROP TABLE IF EXISTS public.specs");
    [light, heavy, read] = await load([
      game("Flat Farm", { tags: ["2D", "Pixel Graphics"], year: 2016 }),
      game("Big Open World", { tags: ["Open World", "Realistic", "3D", "Third Person"], year, price: 5999 }),
      game("Read From Specs", { tags: ["2D", "Pixel Graphics"], year: 2016 }),
    ]);
    expect(await names({ power: ["low"] })).toEqual(expect.arrayContaining(["Flat Farm", "Read From Specs"]));
    expect(await names({ power: ["high"] })).toEqual(["Big Open World"]);
    expect((await search.getGameDetail(light.id))!.summary.powerKnown).toBe(false);
  });

  it("moves a game when its requirements are read", async () => {
    const { saveSpecs } = await import("../src/server/specs.ts");
    await saveSpecs(read.steamAppId!, specs);
    search.resetCatalogCache();
    expect((await names({ power: ["high"] })).sort()).toEqual(["Big Open World", "Read From Specs"]);
    const detail = (await search.getGameDetail(read.id))!;
    expect(detail.summary).toMatchObject({ power: 3, powerKnown: true });
    expect(detail.specs).toMatchObject({ ram: 16, gpuText: "RTX 3060" });
    expect((await search.getGameDetail(light.id))!.specs).toBeNull();
  });

  it("counts every level before the power filter is applied", async () => {
    expect((await run({ power: ["low"] })).powerCounts).toEqual({ low: 1, mid: 0, high: 2 });
    expect((await run({ power: ["low"] })).total).toBe(1);
  });

  it("keeps what was read across a re-crawl", async () => {
    await load([light, heavy, read]);
    expect((await names({ power: ["high"] })).sort()).toEqual(["Big Open World", "Read From Specs"]);
    expect((await search.getMeta()).specsRead).toBe(1);
  });

  it("remembers an app whose requirements say nothing, without giving it a level", async () => {
    const { saveSpecs } = await import("../src/server/specs.ts");
    await saveSpecs(light.steamAppId!, null);
    expect((await search.getGameDetail(light.id))!.summary).toMatchObject({ power: 1, powerKnown: false });
  });
});

