import type { Game, MediaItem, MediaResponse } from "../shared/types.ts";
import { fetchJson } from "./http.ts";

// Screenshots and trailers are never stored or proxied: we only look up their URLs,
// and the browser loads them straight from the stores' CDNs.

const STEAM_ASSETS = "https://shared.akamai.steamstatic.com/store_item_assets/";
const STEAM_VIDEOS = "https://video.akamai.steamstatic.com/store_trailers/";
const CACHE_MS = 24 * 3600 * 1000;
const CACHE_SIZE = 2000;

interface SteamTrailer {
  trailer_name?: string;
  screenshot_full?: string;
  screenshot_medium?: string;
  microtrailer?: { filename: string; type: string }[];
  adaptive_trailers?: { cdn_path: string; encoding: string }[];
}

interface SteamMediaItem {
  screenshots?: { all_ages_screenshots?: { filename: string; ordinal?: number }[] };
  trailers?: { highlights?: SteamTrailer[]; other_trailers?: SteamTrailer[] };
}

/** "steam/apps/1/ss_x.jpg?t=1" -> "steam/apps/1/ss_x.600x338.jpg?t=1" */
const sized = (filename: string, size: string) => filename.replace(/\.jpg(\?|$)/, `.${size}.jpg$1`);

/** Pure mapping from Steam's store-browse response to media items (exported for tests). */
export function steamMedia(item: SteamMediaItem): MediaItem[] {
  const trailers = [...(item.trailers?.highlights ?? []), ...(item.trailers?.other_trailers ?? [])];
  const videos: MediaItem[] = trailers.flatMap((t) => {
    const hls = t.adaptive_trailers?.find((a) => a.encoding === "hls_h264");
    if (!hls) return [];
    const preview = t.microtrailer?.find((m) => m.type === "video/mp4");
    const poster = t.screenshot_full ?? t.screenshot_medium;
    return [
      {
        kind: "video" as const,
        title: t.trailer_name ?? "Trailer",
        thumb: t.screenshot_medium ? `${STEAM_ASSETS}steam/apps/${t.screenshot_medium}` : null,
        poster: poster ? `${STEAM_ASSETS}steam/apps/${poster}` : null,
        hls: `${STEAM_VIDEOS}${hls.cdn_path}`,
        preview: preview ? `${STEAM_VIDEOS}${preview.filename}` : null,
        youtube: null,
      },
    ];
  });
  const shots = [...(item.screenshots?.all_ages_screenshots ?? [])].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const images: MediaItem[] = shots.map((s) => ({
    kind: "image" as const,
    thumb: STEAM_ASSETS + sized(s.filename, "600x338"),
    full: STEAM_ASSETS + sized(s.filename, "1920x1080"),
  }));
  // Steam's store page leads with trailers, then screenshots; keep that order.
  return [...videos, ...images];
}

async function fetchSteamMedia(appId: number): Promise<MediaItem[]> {
  const input = {
    ids: [{ appid: appId }],
    context: { language: "english", country_code: "US" },
    data_request: { include_screenshots: true, include_trailers: true },
  };
  const res = await fetchJson<{ response: { store_items?: SteamMediaItem[] } }>(
    `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`,
    { retries: 1, timeoutMs: 15_000 },
  );
  const item = res.response.store_items?.[0];
  return item ? steamMedia(item) : [];
}

interface GogProduct {
  screenshots?: { formatter_template_url?: string }[];
  videos?: { video_url?: string; thumbnail_url?: string; provider?: string }[];
}

async function fetchGogMedia(productId: string): Promise<MediaItem[]> {
  if (!/^\d+$/.test(productId)) return [];
  const p = await fetchJson<GogProduct>(`https://api.gog.com/products/${productId}?expand=screenshots,videos`, {
    retries: 1,
    timeoutMs: 15_000,
  });
  const videos: MediaItem[] = (p.videos ?? []).flatMap((v) => {
    const id = v.provider === "youtube" ? v.video_url?.match(/embed\/([\w-]{6,})/)?.[1] : undefined;
    return id
      ? [{ kind: "video" as const, title: "Trailer", thumb: v.thumbnail_url ?? null, poster: v.thumbnail_url ?? null, hls: null, preview: null, youtube: id }]
      : [];
  });
  const images: MediaItem[] = (p.screenshots ?? []).flatMap((s) => {
    const t = s.formatter_template_url;
    if (!t) return [];
    const at = (f: string) => t.replace("{formatter}", f).replace(/\.png$/, ".jpg");
    return [{ kind: "image" as const, thumb: at("ggvgm"), full: at("ggvgl_2x") }];
  });
  return [...videos, ...images];
}

const cache = new Map<string, { at: number; value: Promise<MediaResponse> }>();

/** Screenshots and trailers for a game, from Steam if it's there, else GOG. Cached for a day. */
export function getMedia(game: Game): Promise<MediaResponse> {
  const hit = cache.get(game.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const gog = game.stores.find((s) => s.store === "gog");
  const value = (async (): Promise<MediaResponse> => {
    try {
      let items = game.steamAppId ? await fetchSteamMedia(game.steamAppId) : [];
      if (!items.length && gog) items = await fetchGogMedia(gog.storeGameId);
      return { items, error: null };
    } catch (err) {
      cache.delete(game.id); // don't keep failures
      return { items: [], error: `Couldn't load screenshots: ${String(err)}` };
    }
  })();
  cache.set(game.id, { at: Date.now(), value });
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return value;
}
