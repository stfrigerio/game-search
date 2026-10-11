import type { Game } from "../shared/types.ts";

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

function pickCandidate(candidates: Game[], incoming: Game): Game {
  if (candidates.length === 1) return candidates[0];
  const y = year(incoming.releaseDate);
  return [...candidates].sort((a, b) => {
    if (y !== null) {
      const da = Math.abs((year(a.releaseDate) ?? 9999) - y);
      const db = Math.abs((year(b.releaseDate) ?? 9999) - y);
      if (da !== db) return da - db;
    }
    return reviewTotal(b) - reviewTotal(a);
  })[0];
}

function absorb(target: Game, other: Game) {
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
 * Fold per-store catalogues into one list of games. The first catalogue is the
 * base (Steam: biggest and richest metadata); each game from the later ones is
 * merged into a base game with the same title, or added as a new game.
 */
export function mergeCatalogs(catalogs: Game[][]): Game[] {
  const [base = [], ...others] = catalogs;
  const merged = base.map((g) => ({ ...g, stores: [...g.stores] }));
  const byKey = new Map<string, Game[]>();
  const byLooseKey = new Map<string, Game[]>();
  const index = (g: Game) => {
    for (const [map, key] of [
      [byKey, titleKey(g.name)],
      [byLooseKey, looseTitleKey(g.name)],
    ] as const) {
      if (!key) continue;
      const bucket = map.get(key);
      if (bucket) bucket.push(g);
      else map.set(key, [g]);
    }
  };
  merged.forEach(index);

  for (const catalog of others) {
    const added: Game[] = [];
    for (const game of catalog) {
      const store = game.stores[0]?.store;
      const free = (gs: Game[] | undefined) => gs?.filter((g) => !g.stores.some((s) => s.store === store)) ?? [];
      const exact = free(byKey.get(titleKey(game.name)));
      // Loose matches are only trusted when unambiguous.
      const loose = exact.length ? [] : free(byLooseKey.get(looseTitleKey(game.name)));
      const candidates = exact.length ? exact : loose.length === 1 ? loose : [];
      if (candidates.length) {
        absorb(pickCandidate(candidates, game), game);
      } else {
        const copy = { ...game, stores: [...game.stores] };
        merged.push(copy);
        added.push(copy);
      }
    }
    // Index after the loop so games from one store never merge with each other.
    added.forEach(index);
  }
  return merged;
}
