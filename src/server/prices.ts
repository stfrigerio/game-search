import type { Game, PriceLink, PriceOffer, PricesResponse } from "../shared/types.ts";
import { fetchJson } from "./http.ts";

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
  const query = game.steamAppId
    ? `steamAppID=${game.steamAppId}`
    : `title=${encodeURIComponent(game.name)}&exact=1&limit=1`;
  const results = await fetchJson<CsGame[]>(`${CHEAPSHARK}/games?${query}`, { retries: 1 });
  return results[0]?.gameID ?? null;
}

const cents = (s: string) => Math.round(Number(s) * 100);

async function fetchPrices(game: Game): Promise<PricesResponse> {
  const links = priceLinks(game);
  try {
    const id = await findCheapSharkId(game);
    if (!id) return { currency: "USD", offers: [], links, historicLow: null, error: null };
    const [detail, names] = await Promise.all([
      fetchJson<CsGameDetail>(`${CHEAPSHARK}/games?id=${id}`, { retries: 1 }),
      storeNames(),
    ]);
    const offers: PriceOffer[] = detail.deals
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
      historicLow: detail.cheapestPriceEver ? cents(detail.cheapestPriceEver.price) : null,
      error: null,
    };
  } catch (err) {
    return { currency: "USD", offers: [], links, historicLow: null, error: `Price lookup failed: ${String(err)}` };
  }
}

export function getPrices(game: Game): Promise<PricesResponse> {
  const hit = cache.get(game.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = fetchPrices(game).then((res) => {
    if (res.error) cache.delete(game.id); // retry failures on the next request
    return res;
  });
  cache.set(game.id, { at: Date.now(), value });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return value;
}
