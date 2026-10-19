import type { CompareResponse, CompareSide, LibraryGame, LibraryResponse, Recommendation, SharedGame } from "../shared/types.ts";
import { persona, profileHandle } from "../shared/wrapped.ts";

const LIST = 12;
/** Hours on a game before it counts as a favourite worth recommending. */
const FAVOURITE_MINUTES = 10 * 60;

function side(lib: LibraryResponse): CompareSide {
  return {
    steamId: lib.steamId,
    handle: profileHandle(lib),
    profile: lib.profile,
    totals: lib.totals,
    persona: persona(lib),
    topGames: lib.insights.topGames.slice(0, 5),
  };
}

function recommend(from: LibraryResponse, to: Map<number, LibraryGame>): Recommendation[] {
  return from.games
    .filter((g) => g.playtimeMinutes >= FAVOURITE_MINUTES && !(to.get(g.appId)?.playtimeMinutes ?? 0))
    .sort((x, y) => y.playtimeMinutes - x.playtimeMinutes)
    .slice(0, 6)
    .map((g) => ({ appId: g.appId, id: g.id, name: g.name, image: g.image, minutes: g.playtimeMinutes, owned: to.has(g.appId), priceNow: g.priceNow }));
}

/** How much of their play falls under the same tags: 1 - half the L1 distance of the tag shares. */
function tasteMatch(a: LibraryResponse, b: LibraryResponse): number {
  const shares = (lib: LibraryResponse) => {
    const total = lib.insights.byTag.reduce((n, t) => n + t.minutes, 0);
    return new Map(lib.insights.byTag.map((t) => [t.tag, total ? t.minutes / total : 0]));
  };
  const sa = shares(a);
  const sb = shares(b);
  if (!sa.size || !sb.size) return 0;
  let distance = 0;
  for (const tag of new Set([...sa.keys(), ...sb.keys()])) distance += Math.abs((sa.get(tag) ?? 0) - (sb.get(tag) ?? 0));
  return Math.max(0, 1 - distance / 2);
}

/** Two libraries side by side (pure; tested). */
export function buildCompare(a: LibraryResponse, b: LibraryResponse): CompareResponse {
  const ga = new Map(a.games.map((g) => [g.appId, g]));
  const gb = new Map(b.games.map((g) => [g.appId, g]));
  const shared: SharedGame[] = [];
  for (const [appId, x] of ga) {
    const y = gb.get(appId);
    if (!y) continue;
    shared.push({
      appId,
      id: x.id,
      name: x.name,
      image: x.image,
      minutesA: x.playtimeMinutes,
      minutesB: y.playtimeMinutes,
      reviewPct: x.reviewPct,
      onlineCoop: x.onlineCoop,
      onlinePvp: x.onlinePvp,
    });
  }
  const rating = (g: SharedGame) => g.reviewPct ?? -1;
  return {
    currency: a.currency,
    a: side(a),
    b: side(b),
    common: shared.length,
    // Co-op first, then versus; the better-reviewed first within each.
    together: shared
      .filter((g) => g.onlineCoop || g.onlinePvp)
      .sort((x, y) => Number(y.onlineCoop) - Number(x.onlineCoop) || rating(y) - rating(x))
      .slice(0, LIST),
    bothPlayed: shared
      .filter((g) => g.minutesA > 0 && g.minutesB > 0)
      .sort((x, y) => Math.min(y.minutesA, y.minutesB) - Math.min(x.minutesA, x.minutesB))
      .slice(0, LIST),
    aRecommends: recommend(a, gb),
    bRecommends: recommend(b, ga),
    tasteMatch: tasteMatch(a, b),
  };
}
