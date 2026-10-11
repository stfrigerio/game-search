# Deploying on lince (Postgres version)

The site runs as systemd **user** units of lince under `/srv/game-search`, behind Caddy,
and is deployed by `.github/workflows/deploy.yml` on every push to `main`.

What runs:

| Unit | What | Memory |
| --- | --- | --- |
| `game-search.service` | web server, answers searches from Postgres; also reads system requirements from Steam in the background (one request every 1.6 s, kept in `public.specs`) | ~80 MB (cap 384M) |
| `game-search-crawl.service` + `.timer` | nightly catalogue rebuild, ~8 min | ~330 MB peak (cap 768M) |
| `game-search-release.path` + `.service` | after each deploy: migrate, restart, crawl if needed | — |

The catalogue lives in its own database, `game_search` (~400 MB on disk; the part searches
scan is ~70 MB and stays in Postgres' cache).

## One-time setup — do this BEFORE merging to `main`

Deploys replace the app folder but not the unit files in `~/.config/systemd/user/`. The
old unit starts `src/server/index.ts` with tsx, which this version no longer ships, so a
deploy that lands before the units are updated leaves the site down until they are.

### 1. Database (as the postgres superuser: `sudo -u postgres psql`)

```sql
CREATE ROLE game_search LOGIN PASSWORD '<pick one>';
CREATE DATABASE game_search OWNER game_search;
\c game_search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Everything in it is rebuilt by the crawl, so **leave it out of the nightly backup**:
with `pg_dumpall` (Postgres 16+) add `--exclude-database=game_search`; with per-database
`pg_dump`, just don't add it.

### 2. Config file (as the lince user)

```sh
cp deploy/game-search.env.example /srv/game-search/game-search.env
chmod 600 /srv/game-search/game-search.env
nano /srv/game-search/game-search.env      # put the password in DATABASE_URL
```

### 3. Units (as the lince user)

```sh
cp deploy/game-search.service deploy/game-search-crawl.service deploy/game-search-crawl.timer \
   deploy/game-search-release.service deploy/game-search-release.path ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable game-search-crawl.timer game-search-release.path
```

The units call `/usr/bin/node`; if `which node` says otherwise, edit the `ExecStart` lines.

### 4. Merge to `main`

The Deploy workflow runs the tests (including the database ones, against a throwaway
Postgres), builds, and rsyncs the release. On the box, `game-search-release.service` then:

1. runs the migrations (`node dist-server/migrate-cli.js --check`),
2. sees the catalogue is empty and starts `game-search-crawl.service` in the background,
3. restarts the server.

The site shows "Stocking the shelves" with live progress for ~8 minutes, then fills in.
Follow along with `journalctl --user -u game-search-crawl -f`; it ends with
`Catalogue refreshed: … games` and `Peak memory: … MB`.

### 5. Clean up

The old catalogue snapshot isn't used any more: `rm -rf /srv/game-search/data`.

## Day to day

- Crawl now: `systemctl --user start game-search-crawl`
- Next scheduled crawl: `systemctl --user list-timers game-search-crawl.timer`
- Only refresh player counts:
  `cd /srv/game-search/app && set -a && . ../game-search.env && node dist-server/crawl-cli.js --players`
- A failed crawl leaves the previous catalogue live (the site shows the error); the timer
  tries again the next night.
- A release that changes the catalogue tables starts a crawl by itself (the catalogue
  records its schema version).

## Rolling back

Revert the "Move the catalogue to Postgres" merge on `main` and restore the previous
`game-search.service` (it ran `node --import tsx src/server/index.ts` with
`DATA_FILE=/srv/game-search/data/catalog.json.gz`). The database can stay; the old
version ignores it.
