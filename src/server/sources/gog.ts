import type { Game } from "../../shared/types.ts";
import { fetchJson, mapLimit } from "../http.ts";
import type { CrawlOptions } from "./index.ts";
import { GOG_FEATURE_CATEGORIES } from "../../shared/features.ts";

// GOG's public catalogue API (what gog.com/games uses). No key needed.
const PAGE_SIZE = 100;

interface Money {
  amount: string;
}

interface GogProduct {
  id: string;
  slug: string;
  title: string;
  productState?: string;
  features?: { slug: string }[];
  releaseDate?: string | null;
  coverHorizontal?: string | null;
  developers?: string[];
  publishers?: string[];
  operatingSystems?: string[];
  price?: { finalMoney?: Money & { discount?: string }; baseMoney?: Money; discount?: string | null } | null;
  genres?: { name: string }[];
  tags?: { name: string }[];
  reviewsRating?: number;
  reviewsCount?: number;
  storeLink?: string;
}

interface CatalogResponse {
  pages: number;
  productCount: number;
  products: GogProduct[];
}

function pageUrl(page: number, country: string, currency: string) {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    page: String(page),
    order: "asc:title",
    productType: "in:game,pack",
    countryCode: country,
    locale: "en-US",
    currencyCode: currency,
  });
  return `https://catalog.gog.com/v1/catalog?${params}`;
}

const toCents = (m?: Money | null) => (m?.amount ? Math.round(Number(m.amount) * 100) : null);

/** GOG release dates look like "1999.06.01". */
function parseGogDate(d?: string | null): number | null {
  const m = d?.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000);
}

export function gogProductToGame(p: GogProduct): Game | null {
  const name = p.title?.trim();
  if (!p.id || !name) return null;

  const price = toCents(p.price?.finalMoney);
  const basePrice = toCents(p.price?.baseMoney) ?? price;
  const discountPct =
    price !== null && basePrice ? Math.max(0, Math.round((1 - price / basePrice) * 100)) : 0;
  const os = new Set(p.operatingSystems ?? []);
  const tags = [...new Set([...(p.genres ?? []), ...(p.tags ?? [])].map((t) => t.name))];
  const state = p.productState ?? "";

  return {
    id: `gog:${p.id}`,
    name,
    developers: p.developers ?? [],
    publishers: p.publishers ?? [],
    tags,
    description: "",
    image: p.coverHorizontal ?? null,
    releaseDate: parseGogDate(p.releaseDate),
    comingSoon: state.includes("coming-soon"),
    earlyAccess: state.includes("in-development") || state.includes("early-access"),
    platforms: { windows: os.has("windows"), mac: os.has("osx") || os.has("mac"), linux: os.has("linux") },
    deck: 0,
    categories: [...new Set((p.features ?? []).flatMap((f) => GOG_FEATURE_CATEGORIES[f.slug] ?? []))],
    languages: [],
    audioLanguages: [],
    contentDescriptors: [],
    peakPlayers: null,
    owners: null,
    steamAppId: null,
    stores: [
      {
        store: "gog",
        storeGameId: p.id,
        url: p.storeLink ?? `https://www.gog.com/en/game/${p.slug}`,
        price,
        basePrice,
        discountPct,
        discountEnds: null,
        free: price === 0,
        reviewCount: p.reviewsCount ?? 0,
        // GOG rates out of 5 stars, stored as 0-50.
        reviewPct: Math.round(((p.reviewsRating ?? 0) / 50) * 100),
      },
    ],
  };
}

export async function crawlGog({ country, currency, onProgress, limit }: CrawlOptions): Promise<Game[]> {
  const first = await fetchJson<CatalogResponse>(pageUrl(1, country, currency));
  const maxPages = limit ? Math.ceil(limit / PAGE_SIZE) : Infinity;
  const pageCount = Math.min(first.pages, maxPages);
  const pages = Array.from({ length: pageCount - 1 }, (_, i) => i + 2);

  let done = 1;
  onProgress?.(`GOG: page 1/${pageCount}`);
  const rest = await mapLimit(pages, 3, async (page) => {
    const res = await fetchJson<CatalogResponse>(pageUrl(page, country, currency));
    onProgress?.(`GOG: page ${++done}/${pageCount}`);
    return res.products;
  });

  const games = new Map<string, Game>();
  for (const p of [first.products, ...rest].flat()) {
    const game = gogProductToGame(p);
    if (game && !games.has(game.id)) games.set(game.id, game);
  }
  return [...games.values()].slice(0, limit ?? Infinity);
}
