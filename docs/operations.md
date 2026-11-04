# Running and deploying

## Locally

Needs Node 24 (`.nvmrc`) and pnpm (via Corepack). Without `DATABASE_URL` the worker uses an embedded PGlite database,
so no Docker is needed.

```sh
pnpm install
pnpm check                       # format, lint, typecheck, tests
cp .env.example .env             # add the API keys
node --env-file=.env apps/worker/src/main.ts
```

The dashboard runs on demo data without a database or keys:

```sh
pnpm --filter @closing-line/web dev   # http://localhost:3300
```

| Script                                       | What it does                                   |
| -------------------------------------------- | ---------------------------------------------- |
| `pnpm check`                                 | Everything CI runs, except Postgres and Docker |
| `pnpm test:coverage`                         | Tests with a coverage report and thresholds    |
| `pnpm --filter @closing-line/db db:generate` | SQL migration from schema changes              |

`node apps/worker/scripts/screenshots.ts` regenerates the README images from demo data, with the demo dashboard
running on port 3100.

## Settings

Leagues, bookmakers, thresholds, stakes and the credit reserve have defaults in `packages/config/src/schema.ts`. A
JSON file at `CONFIG_PATH` overrides any of them.

## Back-test

`apps/backtest` replays the scanner on free football-data.co.uk season files (Pinnacle's early and closing prices
plus four soft books). It chose the 2% edge threshold ([ADR 0008](adr/0008-edge-threshold-from-the-back-test.md)).

```sh
curl -L -o E1_2425.csv https://football-data.co.uk/mmz4281/2425/E1.csv
pnpm --filter @closing-line/backtest backtest E1_2425.csv --edges 0.015,0.02,0.03
```

A Dixon-Coles goal model was tested on the same files. It doesn't beat Pinnacle, so it isn't a live player and its
code was removed ([ADR 0011](adr/0011-no-goal-model-player.md)).

## Deployment

Docker Compose runs Postgres 18, the worker, the dashboard and a nightly `pg_dump` (14 days kept) on a small VPS.
The dashboard listens on the server's loopback only and opens through an SSH tunnel:

```sh
ssh -N -L 3300:localhost:3000 <server>   # then http://localhost:3300
```

Merges to `main` deploy after CI passes ([deploy.yml](../.github/workflows/deploy.yml)). GitHub Actions streams the
tree over SSH with a key that can only run [server-deploy.sh](../scripts/server-deploy.sh). That script unpacks
aside, removes files deleted from the repo since the last deploy, rebuilds, and fails the deploy unless the worker
reports healthy within three minutes. The workflows run with a read-only token and actions pinned to commit SHAs,
which Dependabot keeps current.

Deploys rebuild the worker and dashboard but never pull Postgres. Take a minor release with
`docker compose pull postgres && docker compose up -d postgres`, and a major one only by dump and restore.

## Backups

`docker/check-backup.sh` proves a backup restores. It loads the newest dump into a scratch database and compares row
counts with the live one:

```sh
docker compose exec -T backup sh -s < docker/check-backup.sh
```
