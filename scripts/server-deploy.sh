#!/usr/bin/env bash
# Deploys a tar of the repo read from stdin, then waits for the container to report healthy.
#
# Installed on the server as ~/bin/deploy-closing-line and bound to the CI deploy key in ~/.ssh/authorized_keys:
#   command="/home/bot/bin/deploy-closing-line",restrict ssh-ed25519 AAAA... github-actions-deploy-closing-line
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
shipped=$(mktemp)
trap 'rm -rf "$incoming" "$shipped"' EXIT
tar -xf - -C "$incoming"
[[ -f $incoming/docker-compose.yml && -f $incoming/package.json ]] || { echo "input is not the repo" >&2; exit 65; }
(cd "$incoming" && find . \( -type f -o -type l \) -print | LC_ALL=C sort) >"$shipped"
mkdir -p "$APP_DIR"
cp -a "$incoming/." "$APP_DIR/"

# Files the previous deploy shipped that this one does not were deleted from the repo; remove them so they stop
# reaching Docker builds. Files made on the server (.env) were never shipped, so they are never on the list.
manifest="$APP_DIR/.deployed-files"
if [[ -f $manifest ]]; then
    LC_ALL=C comm -23 "$manifest" "$shipped" | while IFS= read -r path; do rm -f -- "$APP_DIR/$path"; done
fi
cp "$shipped" "$manifest"

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
        # Every build leaves cache and an untagged old image behind. Both projects on this server build here, so cap
        # the shared build cache by size (enough for fast rebuilds) rather than by age.
        docker builder prune -f --max-used-space 3gb >/dev/null || true
        docker image prune -f >/dev/null || true
        exit 0
    fi
    sleep 5
done
echo "not healthy within 3 minutes: ${unhealthy[*]}" >&2
docker compose logs --tail=30 "${SERVICES[@]}" >&2
exit 1
