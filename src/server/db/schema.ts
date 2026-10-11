import type pg from "pg";

/** The schema the server reads. Crawls build `catalog_staging` and swap it in. */
export const LIVE = "catalog";
export const STAGING = "catalog_staging";

/**
 * Bump when the catalogue tables change. The catalogue is rebuilt from scratch by
 * every crawl, so a new version just means "run the crawl after deploying".
 */
export const SCHEMA_VERSION = 4;

/**
 * Tables for one catalogue. Everything here is rebuilt by each crawl, so the whole
 * schema can be dropped at any time (and doesn't need backing up).
 */
export async function createCatalogTables(client: pg.ClientBase, schema: string) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS ${schema};

    -- Everything searches filter and sort on, kept narrow so a full scan stays in
    -- memory and fast. Display-only data lives in game_details.
    CREATE TABLE IF NOT EXISTS ${schema}.games (
      id                  text PRIMARY KEY,          -- "steam:620", "gog:1207658787"
      search_name         text NOT NULL,             -- normalised title (trigram search, exact match, name sort)
      people              text NOT NULL,             -- normalised developers + publishers
      people_list         text[] NOT NULL,           -- lowercased developer/publisher names, exact filter
      tag_ids             int[] NOT NULL,            -- most relevant first, ids into tags
      release_date        bigint,                    -- unix seconds
      coming_soon         boolean NOT NULL,
      early_access        boolean NOT NULL,
      platforms           smallint NOT NULL,         -- 1 windows, 2 mac, 4 linux
      deck                smallint NOT NULL,
      features            int NOT NULL,              -- bitmask over FEATURES
      langs               int NOT NULL,              -- bitmask over ELanguage ids
      audio               int NOT NULL,
      content             smallint NOT NULL,         -- bitmask over CONTENT_FILTERS
      peak_players        int,
      steam_app_id        int,
      store_ids           text[] NOT NULL,
      review_count        int NOT NULL,
      review_pct          smallint NOT NULL,
      rating              real NOT NULL,
      best_price          int,
      best_base_price     int,
      best_discount       smallint NOT NULL,
      best_discount_ends  bigint,
      best_store          text,
      free                boolean NOT NULL,
      deal_score          real NOT NULL,
      power               smallint NOT NULL,         -- 1 light, 2 medium, 3 demanding
      power_known         boolean NOT NULL           -- read from the store's requirements, not estimated
    );

    CREATE TABLE IF NOT EXISTS ${schema}.game_details (
      id                  text PRIMARY KEY,
      name                text NOT NULL,
      image               text,
      developers          text[] NOT NULL,
      publishers          text[] NOT NULL,
      tags                text[] NOT NULL,
      description         text NOT NULL,
      categories          int[] NOT NULL,            -- raw Steam category ids
      languages           int[] NOT NULL,
      audio_languages     int[] NOT NULL,
      content_descriptors int[] NOT NULL,
      owners              text,
      stores              jsonb NOT NULL             -- StoreListing[]
    );

    CREATE TABLE IF NOT EXISTS ${schema}.tags (
      id    int PRIMARY KEY,
      name  text NOT NULL,
      count int NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ${schema}.meta (
      key   text PRIMARY KEY,
      value jsonb NOT NULL
    );
  `);
}

/** Indexes are built after the bulk load, which is much faster than maintaining them during it. */
export async function createCatalogIndexes(client: pg.ClientBase, schema: string) {
  await client.query(`
    CREATE INDEX IF NOT EXISTS games_search_name_trgm ON ${schema}.games USING gin (search_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS games_people_trgm ON ${schema}.games USING gin (people gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS games_tag_ids ON ${schema}.games USING gin (tag_ids);
    CREATE INDEX IF NOT EXISTS games_people_list ON ${schema}.games USING gin (people_list);
    CREATE INDEX IF NOT EXISTS games_search_name ON ${schema}.games (search_name);
    CREATE INDEX IF NOT EXISTS games_steam_app_id ON ${schema}.games (steam_app_id);
    CREATE INDEX IF NOT EXISTS games_review_count ON ${schema}.games (review_count DESC);
    CREATE INDEX IF NOT EXISTS games_rating ON ${schema}.games (rating DESC, review_count DESC);
    CREATE INDEX IF NOT EXISTS games_peak_players ON ${schema}.games (peak_players DESC NULLS LAST);
  `);
}

/** Extension and crawl status table; needed by both the crawler and the server. */
export async function migrateBase(client: pg.ClientBase) {
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  } catch (err) {
    throw new Error(
      `pg_trgm is missing and this role can't create it. As a superuser run: CREATE EXTENSION pg_trgm; (${String(err)})`,
    );
  }
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.crawl_status (
      id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      state       text NOT NULL DEFAULT 'idle',     -- idle | running | failed
      progress    text,
      started_at  timestamptz,
      finished_at timestamptz,
      error       text
    );
    INSERT INTO public.crawl_status (id) VALUES (1) ON CONFLICT DO NOTHING;

    -- Minimum requirements read from Steam, one app at a time (see specs.ts). Kept
    -- across crawls: all values are NULL for an app whose requirements say nothing.
    CREATE TABLE IF NOT EXISTS public.specs (
      app_id   int PRIMARY KEY,
      ram      real,                                 -- GB
      vram     real,                                 -- GB
      disk     real,                                 -- GB
      gpu      real,                                 -- card speed, GTX 1060 = 6
      gpu_text text NOT NULL DEFAULT '',
      level    smallint,                             -- power level these point to, if any
      read_at  timestamptz NOT NULL DEFAULT now()
    );
    -- The recommended requirements, added after the first version read only the minimum.
    ALTER TABLE public.specs ADD COLUMN IF NOT EXISTS rec_gpu real;
    ALTER TABLE public.specs ADD COLUMN IF NOT EXISTS rec_vram real;
    ALTER TABLE public.specs ADD COLUMN IF NOT EXISTS rec_gpu_text text NOT NULL DEFAULT '';
  `);
}

/**
 * `npm run migrate`: base tables plus an empty live catalogue, so the server can
 * start before the first crawl. Leaves an existing catalogue's data alone. Returns a
 * warning when the live catalogue was built by an older version.
 */
export async function migrate(client: pg.ClientBase): Promise<string | null> {
  await migrateBase(client);
  const { rows } = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [LIVE]);
  if (!rows.length) {
    await createCatalogTables(client, LIVE);
    await createCatalogIndexes(client, LIVE);
    await client.query(`INSERT INTO ${LIVE}.meta (key, value) VALUES ('schema_version', to_jsonb($1::int))`, [SCHEMA_VERSION]);
    return null;
  }
  // A catalogue from before power levels keeps answering (everything "light, estimated")
  // until the crawl that follows this release rebuilds it.
  await client.query(`
    ALTER TABLE ${LIVE}.games ADD COLUMN IF NOT EXISTS power smallint NOT NULL DEFAULT 1;
    ALTER TABLE ${LIVE}.games ADD COLUMN IF NOT EXISTS power_known boolean NOT NULL DEFAULT false;
  `);
  const version = await client
    .query(`SELECT value FROM ${LIVE}.meta WHERE key = 'schema_version'`)
    .then((r) => Number(r.rows[0]?.value ?? 1))
    .catch(() => 1);
  return version === SCHEMA_VERSION
    ? null
    : `The catalogue was built by an older version (schema ${version}, now ${SCHEMA_VERSION}). Run \`npm run crawl\` to rebuild it.`;
}
