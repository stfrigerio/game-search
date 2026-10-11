import { closeDb, db } from "./db/pool.ts";
import { LIVE, migrate } from "./db/schema.ts";

// `npm run migrate`: create the tables (safe to re-run; never touches an existing catalogue).
// With --check it exits with 3 when the catalogue is empty or outdated, i.e. a crawl is
// needed; the release unit uses that to start one after a deploy.
const client = await db().connect();
try {
  const warning = await migrate(client);
  const { rows } = await client.query(`SELECT EXISTS (SELECT 1 FROM ${LIVE}.games) AS has_games`).catch(() => ({ rows: [{ has_games: false }] }));
  const empty = !rows[0].has_games;
  console.log(warning ?? (empty ? "Database ready; the catalogue is empty, run `npm run crawl`." : "Database ready."));
  if (process.argv.includes("--check") && (warning || empty)) process.exitCode = 3;
} finally {
  client.release();
  await closeDb();
}
