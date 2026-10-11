import type { Game } from "../src/shared/types.ts";

let n = 0;

export interface GameOpts {
  tags?: string[];
  reviews?: [number, number];
  price?: number;
  discount?: number;
  year?: number;
  dev?: string;
  categories?: number[];
  languages?: number[];
  audio?: number[];
  content?: number[];
  players?: number;
}

/** A Steam game with sensible defaults for tests. */
export function game(name: string, opts: GameOpts = {}): Game {
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
    categories: opts.categories ?? [],
    languages: opts.languages ?? [0],
    audioLanguages: opts.audio ?? [],
    contentDescriptors: opts.content ?? [],
    peakPlayers: opts.players ?? null,
    owners: null,
    steamAppId: id,
    stores: [
      {
        store: "steam",
        storeGameId: String(id),
        url: "",
        price: opts.price ?? 999,
        basePrice: opts.discount ? Math.round((opts.price ?? 999) / (1 - opts.discount / 100)) : (opts.price ?? 999),
        discountPct: opts.discount ?? 0,
        free: opts.price === 0,
        reviewCount: count,
        reviewPct: pct,
      },
    ],
  };
}
