# Deploying on a droplet with Postgres

The web server answers searches from Postgres and needs ~100 MB. The catalogue is
rebuilt nightly by a separate one-shot job (~8 minutes, ~500 MB peak) that writes to a
staging schema and swaps it in, so the site never sees a half-built catalogue.

Paths below assume the app lives in `/opt/game-search` and runs as user `game-search`.
Adjust the unit files if yours differ (e.g. match your existing `game-search.service`).

## 1. Database (once)

As the postgres superuser (`sudo -u postgres psql`):

```sql
CREATE ROLE game_search LOGIN PASSWORD '<pick one>';
CREATE DATABASE game_search OWNER game_search;
\c game_search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

The database only holds data rebuilt by the crawl (~400 MB on disk), so **leave it out
of backups**. With `pg_dumpall` (Postgres 16+): `pg_dumpall --exclude-database=game_search`.
With per-database `pg_dump`, just don't add it.

## 2. Config

```sh
sudo cp deploy/game-search.env.example /etc/game-search.env
sudo chmod 600 /etc/game-search.env && sudo chown game-search /etc/game-search.env
sudo nano /etc/game-search.env    # set the password in DATABASE_URL
```

## 3. Build

```sh
cd /opt/game-search
git pull
npm ci
npm run build          # dist/ (front-end) and dist-server/ (server, crawler, migrate)
npm prune --omit=dev   # optional: runtime needs only express and pg
```

## 4. Switch the services

```sh
sudo systemctl stop game-search
sudo cp deploy/game-search.service deploy/game-search-crawl.service deploy/game-search-crawl.timer /etc/systemd/system/
sudo systemctl daemon-reload

# Create tables, then build the first catalogue (blocks for ~8 minutes).
sudo -u game-search bash -c 'set -a; . /etc/game-search.env; node dist-server/migrate-cli.js'
sudo systemctl start game-search-crawl
journalctl -u game-search-crawl -n 20    # ends with "Catalogue refreshed: … games" and "Peak memory: … MB"

sudo systemctl enable --now game-search game-search-crawl.timer
systemctl list-timers game-search-crawl.timer
```

The old in-memory catalogue file is no longer used: `rm -rf /opt/game-search/data`.

If `node` isn't on systemd's default PATH (e.g. installed with nvm), replace
`/usr/bin/env node` in both service files with the full path from `which node`.

## 5. Check

```sh
curl -s localhost:3001/api/meta | head -c 300; echo
systemctl status game-search          # Memory: ~70-120M
```

## Day to day

- Crawl now: `sudo systemctl start game-search-crawl`
- Crawl status/progress: `journalctl -u game-search-crawl -f`, or the `public.crawl_status` table
- Only refresh player counts: `node dist-server/crawl-cli.js --players` (with the env loaded)
- After deploying a version whose release notes mention a new catalogue schema, run a crawl;
  `node dist-server/migrate-cli.js` warns when one is needed.
- A failed crawl leaves the previous catalogue live; the timer tries again the next night.

## Rolling back

The previous, in-memory version is the commit before "Move the catalogue to Postgres".
Check it out, `npm ci && npm run build`, and restore the old unit file. It ignores the
database.
