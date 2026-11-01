#!/usr/bin/env bash
# Deploys a tar of the repo read from stdin, then waits for the container to report healthy.
#
# Installed on the server as ~/bin/deploy-betting and bound to the CI deploy key in ~/.ssh/authorized_keys:
#   command="/home/bot/bin/deploy-betting",restrict ssh-ed25519 AAAA... github-actions-deploy-betting
# so that key can run nothing else. After changing this file, copy it to the server again by hand.
set -euo pipefail

APP_DIR="$HOME/closing-line"
SERVICES=(worker web)

# A restart costs at most a minute of ticks; job windows are wider, so no deploy window is needed.
# The lock is shared with the trading bot, so the two never build at the same time.
exec 9>"$HOME/.deploy.lock"
flock -n 9 || { echo "another deploy is running" >&2; exit 75; }

# Unpack aside first, so empty or partial input never touches the running checkout.
incoming=$(mktemp -d)
trap 'rm -rf "$incoming"' EXIT
tar -xf - -C "$incoming"
[[ -f $incoming/docker-compose.yml && -f $incoming/package.json ]] || { echo "input is not the repo" >&2; exit 65; }
mkdir -p "$APP_DIR"
cp -a "$incoming/." "$APP_DIR/"

cd "$APP_DIR"
docker compose up -d --build --remove-orphans

for _ in $(seq 1 36); do
    unhealthy=()
    for service in "${SERVICES[@]}"; do
        status=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q "$service")")
        [[ $status == healthy ]] || unhealthy+=("$service:$status")
    done
    if ((${#unhealthy[@]} == 0)); then
        echo "deployed: ${SERVICES[*]} healthy"
        # Every build leaves cache and an untagged old image behind; keep a week of cache for fast rebuilds.
        docker builder prune -f --filter until=168h >/dev/null || true
        docker image prune -f >/dev/null || true
        exit 0
    fi
    sleep 5
done
echo "not healthy within 3 minutes: ${unhealthy[*]}" >&2
docker compose logs --tail=30 "${SERVICES[@]}" >&2
exit 1
