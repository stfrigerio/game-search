import pg from "pg";

// int8 (bigint) columns hold unix timestamps, well inside Number's safe range.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

let pool: pg.Pool | null = null;

/** Shared connection pool, configured by DATABASE_URL. */
export function db(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set, e.g. postgres://game_search:secret@localhost/game_search");
    }
    pool = new pg.Pool({ connectionString, max: Number(process.env.DB_POOL_SIZE ?? 6) });
  }
  return pool;
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}
