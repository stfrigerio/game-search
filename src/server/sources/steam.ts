import type { DeckCompat, Game } from "../../shared/types.ts";
import { fetchJson, mapLimit } from "../http.ts";
import type { CrawlOptions } from "./index.ts";

// Steam's store front-end APIs. Both work without an API key.
const API = "https://api.steampowered.com";
const PAGE_SIZE = 1000;

interface SteamTag {
  tagid: number;
  name: string;
}

interface SteamItem {
  appid?: number;
  name?: string;
  success?: number;
  is_free?: boolean;
  is_early_access?: boolean;
  is_coming_soon?: boolean;
  tags?: { tagid: number; weight: number }[];
  reviews?: { summary_filtered?: { review_count: number; percent_positive: number } };
  basic_info?: {
    short_description?: string;
    developers?: { name: string }[];
    publishers?: { name: string }[];
  };
  release?: { steam_release_date?: number; original_release_date?: number; is_coming_soon?: boolean };
  platforms?: { windows?: boolean; mac?: boolean; steamos_linux?: boolean; steam_deck_compat_category?: number };
  assets?: { header?: string };
  best_purchase_option?: {
    final_price_in_cents?: string;
    original_price_in_cents?: string;
    discount_pct?: number;
    active_discounts?: { discount_end_date?: number }[];
  };
}

interface QueryResponse {
  response: { metadata: { total_matching_records: number }; store_items?: SteamItem[] };
}

const DATA_REQUEST = {
  include_basic_info: true,
  include_tag_count: 20,
  include_release: true,
  include_reviews: true,
  include_platforms: true,
  include_assets: true,
};

function queryUrl(start: number, country: string) {
  const input = {
    query: { start, count: PAGE_SIZE, sort: 1, filters: { type_filters: { include_games: true } } },
    context: { language: "english", country_code: country },
    data_request: DATA_REQUEST,
  };
  return `${API}/IStoreQueryService/Query/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
}

/** Newer apps keep their header under a hashed path ("<hash>/header.jpg"), so use what Steam reports. */
export function steamImage(appid: number, header = "header.jpg") {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/${header}`;
}

export function steamItemToGame(item: SteamItem, tagNames: Map<number, string>): Game | null {
  const appid = item.appid;
  const name = item.name?.trim();
  if (!appid || !name || item.success !== 1) return null;

  const reviews = item.reviews?.summary_filtered;
  const bpo = item.best_purchase_option;
  const free = !!item.is_free;
  const price = free ? 0 : bpo?.final_price_in_cents ? Number(bpo.final_price_in_cents) : null;
  const basePrice = bpo?.original_price_in_cents ? Number(bpo.original_price_in_cents) : price;
  const release = item.release;
  const releaseDate = release?.steam_release_date || release?.original_release_date || null;
  const deck = item.platforms?.steam_deck_compat_category ?? 0;

  return {
    id: `steam:${appid}`,
    name,
    developers: item.basic_info?.developers?.map((d) => d.name) ?? [],
    publishers: item.basic_info?.publishers?.map((p) => p.name) ?? [],
    tags: [...(item.tags ?? [])]
      .sort((a, b) => b.weight - a.weight)
      .map((t) => tagNames.get(t.tagid))
      .filter((t): t is string => !!t),
    description: item.basic_info?.short_description ?? "",
    image: steamImage(appid, item.assets?.header),
    releaseDate,
    comingSoon: !!(item.is_coming_soon || release?.is_coming_soon),
    earlyAccess: !!item.is_early_access,
    platforms: {
      windows: !!item.platforms?.windows,
      mac: !!item.platforms?.mac,
      linux: !!item.platforms?.steamos_linux,
    },
    deck: (deck >= 0 && deck <= 3 ? deck : 0) as DeckCompat,
    steamAppId: appid,
    stores: [
      {
        store: "steam",
        storeGameId: String(appid),
        url: `https://store.steampowered.com/app/${appid}/`,
        price,
        basePrice,
        discountPct: bpo?.discount_pct ?? 0,
        discountEnds: bpo?.active_discounts?.[0]?.discount_end_date ?? null,
        free,
        reviewCount: reviews?.review_count ?? 0,
        reviewPct: reviews?.percent_positive ?? 0,
      },
    ],
  };
}

export async function crawlSteam({ country, onProgress, limit }: CrawlOptions): Promise<Game[]> {
  const tagList = await fetchJson<{ response: { tags: SteamTag[] } }>(
    `${API}/IStoreService/GetTagList/v1/?language=english`,
  );
  const tagNames = new Map(tagList.response.tags.map((t) => [t.tagid, t.name]));

  const first = await fetchJson<QueryResponse>(queryUrl(0, country));
  const total = Math.min(first.response.metadata.total_matching_records, limit ?? Infinity);
  const starts: number[] = [];
  for (let s = PAGE_SIZE; s < total; s += PAGE_SIZE) starts.push(s);

  let done = 1;
  const pageCount = starts.length + 1;
  onProgress?.(`Steam: page 1/${pageCount}`);
  const rest = await mapLimit(starts, 3, async (start) => {
    const page = await fetchJson<QueryResponse>(queryUrl(start, country));
    onProgress?.(`Steam: page ${++done}/${pageCount}`);
    return page.response.store_items ?? [];
  });

  // Paging over a live catalogue can return the same app twice; keep the first.
  const games = new Map<number, Game>();
  for (const item of [first.response.store_items ?? [], ...rest].flat()) {
    const game = steamItemToGame(item, tagNames);
    if (game && !games.has(game.steamAppId!)) games.set(game.steamAppId!, game);
  }
  return [...games.values()].slice(0, limit ?? Infinity);
}
