import { closeDb, db } from "./db/pool.ts";
import { migrate } from "./db/schema.ts";

// `npm run migrate`: create the tables (safe to re-run).
const client = await db().connect();
try {
  const warning = await migrate(client);
  console.log(warning ?? "Database ready.");
} finally {
  client.release();
  await closeDb();
}
