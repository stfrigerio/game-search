import { describe, expect, it } from "vitest";
import { buildLibrary } from "../src/server/library.ts";

const row = (appid: number, price: number | null, base: number | null, free = false) => ({
  steam_app_id: appid,
  id: `steam:${appid}`,
  name: `Game ${appid}`,
  image: null,
  free,
  best_price: price,
  best_base_price: base,
  best_discount: price !== null && base ? Math.round((1 - price / base) * 100) : 0,
});

describe("buildLibrary", () => {
  it("totals today's value, full price, playtime and the never-played pile", () => {
    const prices = new Map([
      [1, row(1, 999, 1999)], // on sale
      [2, row(2, 1499, 1499)],
      [3, row(3, 0, 0, true)], // free to play
    ]);
    const { totals, games } = buildLibrary(
      [
        { appid: 1, playtime_forever: 600 },
        { appid: 2, playtime_forever: 0 },
        { appid: 3, playtime_forever: 120 },
        { appid: 4, name: "Delisted", playtime_forever: 0 }, // not in the catalogue
      ],
      prices,
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
    expect(games.find((g) => g.appId === 4)).toMatchObject({ id: null, name: "Delisted", priceNow: null });
    expect(games.find((g) => g.appId === 1)).toMatchObject({ priceNow: 999, priceFull: 1999, discountPct: 50 });
  });
});
