import { describe, expect, it } from "vitest";
import { saleEnds } from "../src/client/format.ts";
import { playerModes } from "../src/shared/features.ts";
import { DEFAULT_QUERY, parseQuery, serializeQuery, type SearchQuery } from "../src/shared/query.ts";

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
    const q: SearchQuery = {
      ...DEFAULT_QUERY,
      q: "rogue",
      tags: ["Roguelike"],
      notTags: ["Anime"],
      maxPrice: 20,
      deck: 3,
      features: ["coop", "controllerFull"],
      notFeatures: ["iap"],
      lang: "it",
      audio: true,
      hide: ["sexual"],
      minPlayers: 100,
      minDiscount: 50,
      days: 90,
      dev: "Valve",
      sort: "players",
      page: 3,
    };
    expect(parseQuery(serializeQuery(q))).toEqual(q);
  });

  it("omits defaults so URLs stay short", () => {
    expect(serializeQuery(DEFAULT_QUERY).toString()).toBe("");
  });
});

describe("playerModes", () => {
  it("lists modes like Steam's store page, hiding generic ones covered by specific ones", () => {
    // Cult of the Lamb: Steam's data has Multi-player and Co-op, its page doesn't show them.
    expect(playerModes([2, 1, 9, 39, 24, 22, 44])).toEqual({
      modes: ["Single-player", "Shared/Split Screen Co-op", "Shared/Split Screen", "Remote Play Together"],
      localOnly: true,
    });
  });

  it("keeps generic modes when nothing more specific is known, and online games aren't local-only", () => {
    expect(playerModes([2, 1, 9])).toEqual({ modes: ["Single-player", "Multi-player", "Co-op"], localOnly: false });
    expect(playerModes([1, 9, 38, 39]).localOnly).toBe(false);
  });
});
