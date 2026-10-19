import { describe, expect, it } from "vitest";
import { buildInsights, buildLibrary, type CatalogRow } from "../src/server/library.ts";

function row(appid: number, price: number | null, base: number | null, extra: Partial<CatalogRow> = {}): CatalogRow {
  return {
    steam_app_id: appid,
    id: `steam:${appid}`,
    name: `Game ${appid}`,
    image: null,
    free: false,
    best_price: price,
    best_base_price: base,
    best_discount: price !== null && base ? Math.round((1 - price / base) * 100) : 0,
    tags: [],
    release_date: null,
    rating: 80,
    review_pct: 85,
    review_count: 1000,
    features: 0,
    ...extra,
  };
}

const year = (y: number) => Date.UTC(y, 5, 1) / 1000;

describe("buildLibrary", () => {
  it("totals today's value, full price, playtime and the never-played pile", () => {
    const catalog = new Map([
      [1, row(1, 999, 1999)], // on sale
      [2, row(2, 1499, 1499)],
      [3, row(3, 0, 0, { free: true })], // free to play
    ]);
    const { totals, games } = buildLibrary(
      [
        { appid: 1, playtime_forever: 600 },
        { appid: 2, playtime_forever: 0 },
        { appid: 3, playtime_forever: 120 },
        { appid: 4, name: "Delisted", playtime_forever: 0 }, // not in the catalogue
      ],
      catalog,
    );
    expect(totals).toEqual({
      games: 4,
      priced: 3,
      free: 1,
      valueNow: 999 + 1499,
      valueFull: 1999 + 1499,
      playtimeMinutes: 720,
      neverPlayed: 2,
      neverPlayedValue: 1499,
    });
    expect(games.find((g) => g.appId === 4)).toMatchObject({ id: null, name: "Delisted", priceNow: null, rating: null });
    expect(games.find((g) => g.appId === 1)).toMatchObject({ priceNow: 999, priceFull: 1999, discountPct: 50 });
  });
});

describe("buildInsights", () => {
  const multi = 1 << 1; // FEATURES[1] is "multi"
  const catalog = new Map([
    [1, row(1, 999, 999, { tags: ["Indie", "Roguelike", "Action", "Pixel Graphics"], release_date: year(2020), review_pct: 95, features: multi })],
    [2, row(2, 999, 999, { tags: ["Roguelike", "Strategy"], release_date: year(2022), review_pct: 75 })],
    [3, row(3, 999, 999, { tags: ["Puzzle"], release_date: year(2022), rating: 93, review_pct: 97 })],
    [4, row(4, 999, 999, { tags: ["Puzzle"], release_date: year(2018), rating: 70, review_pct: 72 })],
  ]);
  const { games } = buildLibrary(
    [
      { appid: 1, playtime_forever: 300, playtime_2weeks: 30 },
      { appid: 2, playtime_forever: 100 },
      { appid: 3, playtime_forever: 0 },
      { appid: 4, playtime_forever: 0 },
    ],
    catalog,
  );
  const i = buildInsights(games);

  it("ranks games and tags by hours, skipping generic tags", () => {
    expect(i.topGames.map((g) => g.appId)).toEqual([1, 2]);
    expect(i.byTag[0]).toEqual({ tag: "Roguelike", minutes: 400, games: 2 });
    expect(i.byTag.map((t) => t.tag)).not.toContain("Indie");
  });

  it("counts the library by release year with gaps filled", () => {
    expect(i.byYear.map((y) => y.year)).toEqual([2018, 2019, 2020, 2021, 2022]);
    expect(i.byYear.find((y) => y.year === 2022)).toEqual({ year: 2022, games: 2, minutes: 100, unplayed: 1 });
  });

  it("measures concentration, recent play, taste and the unplayed gems", () => {
    expect(i.concentration).toEqual({ top1: 0.75, next9: 0.25, rest: 0 });
    expect(i.recent).toEqual([{ appId: 1, id: "steam:1", name: "Game 1", minutes: 30 }]);
    expect(i.unplayedGems.map((g) => g.appId)).toEqual([3, 4]);
    expect(i.avgReviewPct).toBe(Math.round((95 * 300 + 75 * 100) / 400));
    expect(i.multiplayerMinutes).toBe(300);
  });
});
