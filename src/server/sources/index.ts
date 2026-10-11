import type { Game, StoreId } from "../../shared/types.ts";
import { crawlGog } from "./gog.ts";
import { crawlSteam } from "./steam.ts";

export interface CrawlOptions {
  /** ISO country code used for regional prices, e.g. "US". */
  country: string;
  /** Currency matching `country`, e.g. "USD" (GOG needs it spelled out). */
  currency: string;
  onProgress?: (message: string) => void;
  /** Stop after roughly this many games; for quick local testing. */
  limit?: number;
}

export { crawlSteam };

/**
 * Stores crawled after Steam. Steam is the base catalogue (streamed, see steam.ts);
 * each of these returns its games, which are merged into Steam games with the same
 * title or added as new games. Add a new store here.
 */
export const OTHER_SOURCES: Partial<Record<StoreId, (opts: CrawlOptions) => Promise<Game[]>>> = {
  gog: crawlGog,
};
