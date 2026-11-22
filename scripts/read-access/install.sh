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

# A weekly copy of the newest backup on this Mac (Sundays 12:00, or at the next wake if asleep then).
label=local.closing-line.pull-backup
plist="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Backups/closing-line"
cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key><array><string>/bin/bash</string><string>$here/pull-backup.sh</string></array>
    <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>12</integer></dict>
    <key>StandardOutPath</key><string>$HOME/Backups/closing-line/pull.log</string>
    <key>StandardErrorPath</key><string>$HOME/Backups/closing-line/pull.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"

echo
echo "Done. Test: echo 'select count(*) from bets' | ssh hetzner-read db-read"
echo "Backups: bash $here/pull-backup.sh now, then weekly into ~/Backups/closing-line"
