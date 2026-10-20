import type { Game, PriceLink, PriceOffer, PricesResponse } from "../shared/types.ts";
import { fetchJson, mapLimit } from "./http.ts";

// CheapShark tracks official stores (Steam, GOG, Humble, Fanatical, GMG, Epic, ...). Prices are USD.
const CHEAPSHARK = "https://www.cheapshark.com/api/1.0";
const CACHE_MS = 15 * 60 * 1000;

interface CsStore {
  storeID: string;
  storeName: string;
  isActive: number;
}
interface CsGame {
  gameID: string;
}
interface CsGameDetail {
  cheapestPriceEver?: { price: string };
  deals: { storeID: string; dealID: string; price: string; retailPrice: string; savings: string }[];
}

/**
 * Sites we can't get prices from but are worth checking. Keyshops (G2A, Kinguin, ...)
 * resell keys on a grey market: often cheaper, but the publisher isn't paid and
 * keys are occasionally revoked. Edit this list to add or remove sites.
 */
export function priceLinks(game: Game): PriceLink[] {
  const q = encodeURIComponent(game.name);
  const plus = encodeURIComponent(game.name).replace(/%20/g, "+");
  const links: PriceLink[] = [
    { shop: "Humble Store", kind: "official", url: `https://www.humblebundle.com/store/search?search=${q}` },
    { shop: "Fanatical", kind: "official", url: `https://www.fanatical.com/en/search?search=${q}` },
    { shop: "G2A", kind: "keyshop", url: `https://www.g2a.com/search?query=${q}` },
    { shop: "Kinguin", kind: "keyshop", url: `https://www.kinguin.net/listing?phrase=${q}` },
    { shop: "Eneba", kind: "keyshop", url: `https://www.eneba.com/store/all?text=${q}` },
    { shop: "Instant Gaming", kind: "keyshop", url: `https://www.instant-gaming.com/en/search/?q=${q}` },
    { shop: "Gamivo", kind: "keyshop", url: `https://www.gamivo.com/search/${q}` },
    { shop: "Loaded (CDKeys)", kind: "keyshop", url: `https://www.loaded.com/catalogsearch/result/?q=${q}` },
    { shop: "AllKeyShop", kind: "tracker", url: `https://www.allkeyshop.com/blog/products/?search_name=${plus}` },
    {
      shop: "GG.deals",
      kind: "tracker",
      url: game.steamAppId ? `https://gg.deals/steam/app/${game.steamAppId}/` : `https://gg.deals/search/?title=${q}`,
    },
    { shop: "IsThereAnyDeal", kind: "tracker", url: `https://isthereanydeal.com/search/?q=${q}` },
  ];
  if (game.steamAppId) {
    links.push({ shop: "SteamDB", kind: "tracker", url: `https://steamdb.info/app/${game.steamAppId}/` });
  }
  return links;
}

const cache = new Map<string, { at: number; value: Promise<PricesResponse> }>();
/** Our game id -> CheapShark game id (null = CheapShark doesn't know it). These never change. */
const cheapSharkIds = new Map<string, string | null>();
let storesPromise: Promise<Map<string, string>> | null = null;

function storeNames(): Promise<Map<string, string>> {
  storesPromise ??= fetchJson<CsStore[]>(`${CHEAPSHARK}/stores`, { retries: 1 })
    .then((stores) => new Map(stores.map((s) => [s.storeID, s.storeName])))
    .catch((err) => {
      storesPromise = null;
      throw err;
    });
  return storesPromise;
}

async function findCheapSharkId(game: Game): Promise<string | null> {
  if (cheapSharkIds.has(game.id)) return cheapSharkIds.get(game.id)!;
  const query = game.steamAppId
    ? `steamAppID=${game.steamAppId}`
    : `title=${encodeURIComponent(game.name)}&exact=1&limit=1`;
  const results = await fetchJson<CsGame[]>(`${CHEAPSHARK}/games?${query}`, { retries: 1 });
  const id = results[0]?.gameID ?? null;
  cheapSharkIds.set(game.id, id);
  return id;
}

const cents = (s: string) => Math.round(Number(s) * 100);

function buildResponse(game: Game, detail: CsGameDetail | null, names: Map<string, string>): PricesResponse {
  const links = priceLinks(game);
  const offers: PriceOffer[] = (detail?.deals ?? [])
    .map((d) => ({
      shop: names.get(d.storeID) ?? `Store ${d.storeID}`,
      price: cents(d.price),
      basePrice: cents(d.retailPrice),
      discountPct: Math.round(Number(d.savings)),
      url: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
      kind: "official" as const,
    }))
    .sort((a, b) => a.price - b.price);
  // Don't also link to a store we already have a live price for.
  const priced = new Set(offers.map((o) => o.shop.toLowerCase()));
  return {
    currency: "USD",
    offers,
    links: links.filter((l) => !priced.has(l.shop.toLowerCase())),
    historicLow: detail?.cheapestPriceEver ? cents(detail.cheapestPriceEver.price) : null,
    error: null,
  };
}

async function fetchPrices(game: Game): Promise<PricesResponse> {
  try {
    const id = await findCheapSharkId(game);
    const [detail, names] = await Promise.all([
      id ? fetchJson<CsGameDetail>(`${CHEAPSHARK}/games?id=${id}`, { retries: 1 }) : null,
      storeNames(),
    ]);
    return buildResponse(game, detail, names);
  } catch (err) {
    return { ...buildResponse(game, null, new Map()), error: `Price lookup failed: ${String(err)}` };
  }
}

function remember(id: string, value: Promise<PricesResponse>) {
  const tracked = value.then((res) => {
    if (res.error) cache.delete(id); // retry failures on the next request
    return res;
  });
  cache.set(id, { at: Date.now(), value: tracked });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return tracked;
}

function cached(id: string): Promise<PricesResponse> | null {
  const hit = cache.get(id);
  return hit && Date.now() - hit.at < CACHE_MS ? hit.value : null;
}

/** Prices someone looked up in the last few minutes, without asking CheapShark; null otherwise. */
export async function recentPrices(id: string): Promise<PricesResponse | null> {
  const hit = cache.get(id);
  if (!hit || Date.now() - hit.at >= CACHE_MS) return null;
  const done = await Promise.race([hit.value, Promise.resolve(null)]);
  return done && !done.error ? done : null;
}

export function getPrices(game: Game): Promise<PricesResponse> {
  return cached(game.id) ?? remember(game.id, fetchPrices(game));
}

const BATCH = 25; // CheapShark's limit for /games?ids=

/**
 * Prices for many games with as few CheapShark calls as possible: ids are
 * resolved once (and kept forever), then deals are fetched 25 games per request.
 */
export async function getPricesBatch(games: Game[]): Promise<Map<string, PricesResponse>> {
  const out = new Map<string, PricesResponse>();
  const missing = games.filter((g) => !cached(g.id));
  if (missing.length) {
    const resolved = await mapLimit(missing, 2, async (g) => {
      try {
        return { game: g, csId: await findCheapSharkId(g) };
      } catch {
        return { game: g, csId: undefined }; // lookup failed; try again next time
      }
    });
    const names = await storeNames().catch(() => new Map<string, string>());
    const withIds = resolved.filter((r): r is { game: Game; csId: string } => !!r.csId);
    for (const r of resolved) if (r.csId === null) remember(r.game.id, Promise.resolve(buildResponse(r.game, null, names)));
    for (let k = 0; k < withIds.length; k += BATCH) {
      const chunk = withIds.slice(k, k + BATCH);
      const request = fetchJson<Record<string, CsGameDetail>>(
        `${CHEAPSHARK}/games?ids=${chunk.map((c) => c.csId).join(",")}`,
        { retries: 1 },
      );
      for (const { game, csId } of chunk) {
        remember(
          game.id,
          request.then(
            (details) => buildResponse(game, details[csId] ?? null, names),
            (err) => ({ ...buildResponse(game, null, names), error: `Price lookup failed: ${String(err)}` }),
          ),
        );
      }
    }
  }
  for (const g of games) {
    const value = cached(g.id);
    if (value) out.set(g.id, await value);
  }
  return out;
}
