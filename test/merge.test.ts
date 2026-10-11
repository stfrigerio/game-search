import { describe, expect, it } from "vitest";
import { looseTitleKey, mergeCatalogs, titleKey } from "../src/server/merge.ts";
import type { Game, StoreId } from "../src/shared/types.ts";

function game(store: StoreId, id: string, name: string, extra: Partial<Game> = {}): Game {
  return {
    id: `${store}:${id}`,
    name,
    developers: [],
    publishers: [],
    tags: [],
    description: "",
    image: null,
    releaseDate: null,
    comingSoon: false,
    earlyAccess: false,
    platforms: { windows: true, mac: false, linux: false },
    deck: 0,
    steamAppId: store === "steam" ? Number(id) : null,
    stores: [
      { store, storeGameId: id, url: "", price: 999, basePrice: 999, discountPct: 0, free: false, reviewCount: 10, reviewPct: 90 },
    ],
    ...extra,
  };
}

describe("titleKey", () => {
  it("ignores case, trademark symbols and punctuation", () => {
    expect(titleKey("The Witcher® 3: Wild Hunt™")).toBe(titleKey("the witcher 3 - wild hunt"));
    expect(titleKey("Ori & the Blind Forest")).toBe(titleKey("Ori and the Blind Forest"));
    expect(titleKey("Pokémon")).toBe("pokemon");
  });

  it("loose key drops edition suffixes and normalises roman numerals", () => {
    expect(looseTitleKey("Heroes of Might and Magic III: Complete Edition")).toBe(looseTitleKey("Heroes of Might & Magic 3"));
    expect(looseTitleKey("The Witcher: Enhanced Edition")).toBe("witcher");
    expect(looseTitleKey("Doom")).not.toBe(looseTitleKey("Doom II"));
  });
});

describe("mergeCatalogs", () => {
  it("folds the same game from two stores into one entry", () => {
    const steam = [game("steam", "1", "Disco Elysium", { platforms: { windows: true, mac: false, linux: false } })];
    const gog = [game("gog", "a", "Disco Elysium™", { platforms: { windows: true, mac: true, linux: false }, tags: ["RPG"] })];
    const merged = mergeCatalogs([steam, gog]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("steam:1");
    expect(merged[0].stores.map((s) => s.store)).toEqual(["steam", "gog"]);
    expect(merged[0].platforms.mac).toBe(true);
    expect(merged[0].tags).toContain("RPG");
  });

  it("keeps games only sold on one store", () => {
    const merged = mergeCatalogs([[game("steam", "1", "Portal")], [game("gog", "a", "Planescape: Torment")]]);
    expect(merged.map((g) => g.id)).toEqual(["steam:1", "gog:a"]);
  });

  it("uses loose matches only when they are unambiguous", () => {
    const steam = [game("steam", "1", "Thief Gold"), game("steam", "2", "Thief Deluxe Edition")];
    const merged = mergeCatalogs([steam, [game("gog", "a", "Thief")]]);
    expect(merged).toHaveLength(3);
  });

  it("picks the candidate with the closest release year when titles collide", () => {
    const y = (year: number) => Date.UTC(year, 0, 1) / 1000;
    const steam = [game("steam", "1", "DOOM", { releaseDate: y(2016) }), game("steam", "2", "Doom", { releaseDate: y(1993) })];
    const merged = mergeCatalogs([steam, [game("gog", "a", "DOOM", { releaseDate: y(1993) })]]);
    expect(merged.find((g) => g.id === "steam:2")!.stores).toHaveLength(2);
    expect(merged.find((g) => g.id === "steam:1")!.stores).toHaveLength(1);
  });

  it("never merges two games from the same store", () => {
    const merged = mergeCatalogs([[game("steam", "1", "Tetris")], [game("gog", "a", "Tetris"), game("gog", "b", "Tetris")]]);
    expect(merged).toHaveLength(2);
  });
});
