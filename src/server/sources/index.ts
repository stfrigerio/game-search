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

/**
 * Every catalogue we crawl. Each returns games listed on that one store; merge.ts
 * then folds listings of the same game together. Add a new store here.
 */
export const SOURCES: Record<StoreId, (opts: CrawlOptions) => Promise<Game[]>> = {
  steam: crawlSteam,
  gog: crawlGog,
};
