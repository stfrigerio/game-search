import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { CatalogStatus, Game, StoreId } from "../shared/types.ts";
import { mergeCatalogs } from "./merge.ts";
import { SearchIndex } from "./search.ts";
import { SOURCES, type CrawlOptions } from "./sources/index.ts";
import { crawlSteamSpy, type SpyStats } from "./sources/steamspy.ts";

interface Snapshot {
  updatedAt: string;
  currency: string;
  games: Game[];
}

export interface CatalogConfig {
  file: string;
  country: string;
  currency: string;
  /** Re-crawl when the snapshot is older than this. */
  maxAgeMs: number;
  limit?: number;
  /** Skip the slow (~5 min) SteamSpy player-count crawl. */
  skipSteamSpy?: boolean;
}

/** Owns the current search index and keeps it fresh by re-crawling in the background. */
export class Catalog {
  index: SearchIndex | null = null;
  private updatedAt: Date | null = null;
  private currency: string;
  private refreshing: Promise<void> | null = null;
  private progress: string | null = null;
  private lastError: string | null = null;

  constructor(private readonly config: CatalogConfig) {
    this.currency = config.currency;
  }

  status(): CatalogStatus {
    const storeCounts: Partial<Record<StoreId, number>> = {};
    for (const g of this.index?.games ?? []) {
      for (const s of g.stores) storeCounts[s.store] = (storeCounts[s.store] ?? 0) + 1;
    }
    return {
      gameCount: this.index?.games.length ?? 0,
      storeCounts,
      updatedAt: this.updatedAt?.toISOString() ?? null,
      refreshing: !!this.refreshing,
      progress: this.progress,
      currency: this.currency,
      lastError: this.lastError,
    };
  }

  /** Load the snapshot from disk if there is one. Returns false when missing or unreadable. */
  async load(): Promise<boolean> {
    try {
      const snap = JSON.parse(gunzipSync(await readFile(this.config.file)).toString("utf8")) as Snapshot;
      this.install(snap);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Could not read catalog:", err);
      return false;
    }
  }

  isStale(): boolean {
    return !this.updatedAt || Date.now() - this.updatedAt.getTime() > this.config.maxAgeMs;
  }

  /** Crawl every store and swap in the new index. Concurrent calls share one crawl. */
  refresh(): Promise<void> {
    this.refreshing ??= this.crawl().finally(() => {
      this.refreshing = null;
      this.progress = null;
    });
    return this.refreshing;
  }

  private async crawl() {
    const { country, currency, limit } = this.config;
    const opts: CrawlOptions = {
      country,
      currency,
      limit,
      onProgress: (msg) => {
        this.progress = msg;
      },
    };
    try {
      const started = Date.now();
      // Sequential keeps us polite to each store; Steam goes first as the merge base.
      const catalogs: Game[][] = [];
      for (const [store, crawl] of Object.entries(SOURCES)) {
        try {
          catalogs.push(await crawl(opts));
        } catch (err) {
          // One store being down shouldn't wipe the others; keep its previous listings.
          console.warn(`Crawling ${store} failed:`, err);
          catalogs.push(this.previousListings(store as StoreId));
        }
      }
      const games = mergeCatalogs(catalogs);
      await this.addPlayerCounts(games);
      const snap: Snapshot = { updatedAt: new Date().toISOString(), currency, games };
      if (!snap.games.length) throw new Error("Crawl returned no games");
      this.install(snap);
      await this.save(snap);
      this.lastError = null;
      console.log(`Catalog refreshed: ${snap.games.length} games in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (err) {
      this.lastError = String(err);
      console.error("Catalog refresh failed:", err);
    }
  }

  private async save(snap: Snapshot) {
    const { file } = this.config;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, gzipSync(JSON.stringify(snap)));
    await rename(`${file}.tmp`, file);
  }

  /** Refresh only player counts (SteamSpy) on the loaded catalogue and save it. */
  async refreshPlayerCounts(): Promise<void> {
    if (!this.index || !this.updatedAt) throw new Error("No catalogue loaded");
    const games = this.index.games;
    await this.addPlayerCounts(games);
    const snap: Snapshot = { updatedAt: this.updatedAt.toISOString(), currency: this.currency, games };
    this.install(snap);
    await this.save(snap);
  }

  /** Fill peak players / owners from SteamSpy; on failure keep the previous numbers. */
  private async addPlayerCounts(games: Game[]) {
    let stats: Map<number, SpyStats>;
    try {
      if (this.config.skipSteamSpy) throw new Error("disabled");
      stats = await crawlSteamSpy((msg) => (this.progress = msg), this.config.limit ? 2 : undefined);
    } catch (err) {
      console.warn("SteamSpy unavailable, keeping previous player counts:", String(err));
      stats = new Map();
      for (const g of this.index?.games ?? []) {
        if (g.steamAppId && g.peakPlayers !== null) stats.set(g.steamAppId, { peakPlayers: g.peakPlayers, owners: g.owners ?? "" });
      }
    }
    for (const g of games) {
      const s = g.steamAppId ? stats.get(g.steamAppId) : undefined;
      if (s) {
        g.peakPlayers = s.peakPlayers;
        g.owners = s.owners || null;
      }
    }
  }

  /** Single-store games rebuilt from the current index, used when that store's crawl fails. */
  private previousListings(store: StoreId): Game[] {
    return (this.index?.games ?? []).flatMap((g) => {
      const listing = g.stores.find((s) => s.store === store);
      return listing ? [{ ...g, id: `${store}:${listing.storeGameId}`, stores: [listing] }] : [];
    });
  }

  private install(snap: Snapshot) {
    this.index = new SearchIndex(snap.games);
    this.updatedAt = new Date(snap.updatedAt);
    this.currency = snap.currency;
  }
}
