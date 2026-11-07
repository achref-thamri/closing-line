#!/usr/bin/env bash
# Read-only access to Closing Line on the server, for checks without the owner's own key; run once on the Mac:
#   bash scripts/read-access/install.sh
# - A separate key, ~/.ssh/hetzner_read, which the server only lets run db-read (SELECT as the read-only role) and
#   cl-logs (container logs). It has no passphrase because it can do nothing else.
# - An SSH alias `hetzner-read` for that key, added to ~/.ssh/config if missing.
# - The server half (server-setup.sh), sent over the owner's own `hetzner` alias.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
key="$HOME/.ssh/hetzner_read"
# The server address comes from the owner's `hetzner` alias, so it isn't written in the repo.
host=$(ssh -G hetzner | awk '$1 == "hostname" { print $2 }')

[[ -f $key ]] || ssh-keygen -q -t ed25519 -N "" -C "closing-line read-only" -f "$key"

if ! grep -q "^Host hetzner-read$" "$HOME/.ssh/config" 2>/dev/null; then
    cat >>"$HOME/.ssh/config" <<CONFIG

# Read-only checks on Closing Line: the server only lets this key run db-read and cl-logs.
Host hetzner-read
  HostName $host
  User bot
  IdentityFile $key
  IdentitiesOnly yes
CONFIG
fi

ssh hetzner "bash -s -- '$(cat "$key.pub")'" <"$here/server-setup.sh"
echo
echo "Done. Test: echo 'select count(*) from bets' | ssh hetzner-read db-read"
