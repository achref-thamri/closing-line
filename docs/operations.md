# Running and deploying

## Locally

Needs Node 24 (`.nvmrc`) and pnpm (via Corepack). Without `DATABASE_URL` the worker uses an embedded PGlite database,
so no Docker is needed.

```sh
corepack enable                  # once, gives you the pnpm version in package.json
pnpm install
pnpm check                       # format, lint, typecheck, tests
cp .env.example .env             # add the keys below
node --env-file=.env apps/worker/src/main.ts
```

The worker needs four keys, all free:

| Variable                 | Where to get it                                                                |
| ------------------------ | ------------------------------------------------------------------------------ |
| `ODDS_API_KEY`           | Sign up at [the-odds-api.com](https://the-odds-api.com) (500 credits a month)  |
| `FOOTBALL_DATA_TOKEN`    | Register at [football-data.org](https://www.football-data.org/client/register) |
| `TELEGRAM_BOT_TOKEN`     | Register a Telegram account for it with [@BotFather](https://t.me/BotFather)   |
| `TELEGRAM_OWNER_CHAT_ID` | Your own chat id with that account. See below                                  |

For the chat id, send the new account any message before starting the worker, then open
`https://api.telegram.org/bot<token>/getUpdates` and copy `message.chat.id`. Once the worker runs it reads the
updates itself and that page stays empty. The owner gets the alerts and the Allow button when someone else sends the
account `/start`.

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
JSON file at `CONFIG_PATH` overrides any of them and leaves the rest at their defaults.

The default bookmakers are the ones with a Danish betting licence, so winnings are tax-free there, and money is in
kroner. Somewhere else, pick up to
ten from [The Odds API's list](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html), keeping `pinnacle` as
the fair price:

```json
{
    "bookmakers": ["pinnacle", "williamhill", "betvictor", "paddypower", "skybet"],
    "timezone": "Europe/London"
}
```

## Back-test

`apps/backtest` replays the scanner on free football-data.co.uk season files (Pinnacle's early and closing prices
plus four soft books). It chose the 2% edge threshold ([ADR 0008](adr/0008-edge-threshold-from-the-back-test.md)).

```sh
curl -L -o E1_2425.csv https://football-data.co.uk/mmz4281/2425/E1.csv
pnpm --filter @closing-line/backtest backtest E1_2425.csv --edges 0.015,0.02,0.03
```

A Dixon-Coles goal model was tested on the same files. It doesn't beat Pinnacle, so it isn't a live player and its
code was removed ([ADR 0011](adr/0011-no-goal-model-player.md)).

## Hosting it yourself

Any Linux server with Docker will do. Clone the repo, fill in `.env` (with `POSTGRES_PASSWORD` this time) and run
`docker compose up -d --build`. That is all a server needs; the automatic deploys below are optional.

To deploy from GitHub Actions like this repo does:

1. Create a user called `bot` on the server (the workflow logs in with that name) and copy
   [server-deploy.sh](../scripts/server-deploy.sh) to `/home/bot/bin/deploy-closing-line`.
2. Make an SSH key pair for the deploy. Add the public half to `/home/bot/.ssh/authorized_keys` with the forced
   command from the top of `server-deploy.sh`, so the key can run nothing else.
3. In the GitHub repo, create an environment called `production` that only `main` can deploy to, and give it three
   secrets: `DEPLOY_SSH_KEY` (the private half), `DEPLOY_HOST` (the server address) and `DEPLOY_KNOWN_HOSTS` (the
   output of `ssh-keyscan <server>`).

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
