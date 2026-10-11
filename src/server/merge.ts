import type { Game, StoreId } from "../shared/types.ts";

/** Lowercased, accent/symbol-free title used to spot the same game on different stores. */
export function titleKey(name: string): string {
  return name
    .replace(/[™®©℠]/g, "") // before NFKD, which would turn ™ into "TM"
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
const EDITION =
  /\s(?:game of the year|goty|complete|definitive|enhanced|deluxe|digital deluxe|ultimate|gold|standard|special|anniversary)(?: edition)?$|\sedition$/;

/** A looser key: drops edition suffixes, a leading "the" and normalises roman numerals. */
export function looseTitleKey(name: string): string {
  let key = titleKey(name)
    .replace(/^the\s/, "")
    .split(" ")
    .map((w) => ROMAN[w] ?? w)
    .join(" ");
  // Strip stacked suffixes like "... gold edition".
  for (let prev = ""; prev !== key; ) {
    prev = key;
    key = key.replace(EDITION, "").trim();
  }
  return key;
}

const year = (ts: number | null) => (ts ? new Date(ts * 1000).getUTCFullYear() : null);
const reviewTotal = (g: Game) => g.stores.reduce((n, s) => n + s.reviewCount, 0);

/** What the matcher remembers about a game: enough to pick between same-titled games. */
interface Entry {
  id: string;
  year: number | null;
  reviews: number;
  stores: Set<StoreId>;
}

/**
 * Finds the game a listing from another store belongs to, by title. Keeps only a
 * small entry per game, so the crawler can match GOG against ~200k Steam games
 * without holding the games themselves.
 */
export class TitleMatcher {
  private readonly byKey = new Map<string, Entry[]>();
  private readonly byLooseKey = new Map<string, Entry[]>();
  private pending: Entry[] = [];
  private pendingNames: string[] = [];

  /** Remember a game. It becomes matchable after the next `commit()`. */
  add(game: Game) {
    this.pending.push({
      id: game.id,
      year: year(game.releaseDate),
      reviews: reviewTotal(game),
      stores: new Set(game.stores.map((s) => s.store)),
    });
    this.pendingNames.push(game.name);
  }

  /**
   * Make added games matchable. Games from one store are committed only after that
   * store's matching is done, so two games from the same store never merge.
   */
  commit() {
    this.pending.forEach((e, k) => {
      for (const [map, key] of [
        [this.byKey, titleKey(this.pendingNames[k])],
        [this.byLooseKey, looseTitleKey(this.pendingNames[k])],
      ] as const) {
        if (!key) continue;
        const bucket = map.get(key);
        if (bucket) bucket.push(e);
        else map.set(key, [e]);
      }
    });
    this.pending = [];
    this.pendingNames = [];
  }

  /** Id of the game `game` should merge into, or null. Claims that game for `game`'s store. */
  match(game: Game): string | null {
    const store = game.stores[0]?.store;
    const free = (es: Entry[] | undefined) => es?.filter((e) => !store || !e.stores.has(store)) ?? [];
    const exact = free(this.byKey.get(titleKey(game.name)));
    // Loose matches are only trusted when unambiguous.
    const loose = exact.length ? [] : free(this.byLooseKey.get(looseTitleKey(game.name)));
    const candidates = exact.length ? exact : loose.length === 1 ? loose : [];
    if (!candidates.length) return null;
    const pick = pickCandidate(candidates, year(game.releaseDate));
    if (store) pick.stores.add(store);
    return pick.id;
  }
}

function pickCandidate(candidates: Entry[], y: number | null): Entry {
  if (candidates.length === 1) return candidates[0];
  return [...candidates].sort((a, b) => {
    if (y !== null) {
      const da = Math.abs((a.year ?? 9999) - y);
      const db = Math.abs((b.year ?? 9999) - y);
      if (da !== db) return da - db;
    }
    return b.reviews - a.reviews;
  })[0];
}

/** Fold `other` (the same game from another store) into `target`. */
export function absorb(target: Game, other: Game) {
  for (const listing of other.stores) {
    if (!target.stores.some((s) => s.store === listing.store)) target.stores.push(listing);
  }
  target.tags = [...new Set([...target.tags, ...other.tags])];
  target.platforms = {
    windows: target.platforms.windows || other.platforms.windows,
    mac: target.platforms.mac || other.platforms.mac,
    linux: target.platforms.linux || other.platforms.linux,
  };
  target.categories = [...new Set([...target.categories, ...other.categories])];
  if (!target.languages.length) target.languages = other.languages;
  if (!target.audioLanguages.length) target.audioLanguages = other.audioLanguages;
  target.description ||= other.description;
  target.image ??= other.image;
  target.releaseDate ??= other.releaseDate;
  if (!target.developers.length) target.developers = other.developers;
  if (!target.publishers.length) target.publishers = other.publishers;
}

/**
 * Fold per-store catalogues into one list of games, in memory. The first catalogue
 * is the base (Steam: biggest and richest metadata); each game from the later ones
 * is merged into a base game with the same title, or added as a new game.
 */
export function mergeCatalogs(catalogs: Game[][]): Game[] {
  const [base = [], ...others] = catalogs;
  const merged = base.map((g) => ({ ...g, stores: [...g.stores] }));
  const byId = new Map(merged.map((g) => [g.id, g]));
  const matcher = new TitleMatcher();
  merged.forEach((g) => matcher.add(g));
  matcher.commit();
  for (const catalog of others) {
    for (const game of catalog) {
      const target = matcher.match(game);
      if (target) {
        absorb(byId.get(target)!, game);
      } else {
        const copy = { ...game, stores: [...game.stores] };
        merged.push(copy);
        byId.set(copy.id, copy);
        matcher.add(copy);
      }
    }
    matcher.commit();
  }
  return merged;
}
