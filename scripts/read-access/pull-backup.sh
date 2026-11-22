#!/usr/bin/env bash
# Copies the newest nightly dump to this Mac over the read-only key and keeps the last 8, so a lost server doesn't
# take the only backups with it. Run weekly (install.sh schedules it):  bash scripts/read-access/pull-backup.sh
set -euo pipefail
dir="$HOME/Backups/closing-line"
keep=8
mkdir -p "$dir"
file="$dir/closing-line-$(date +%F).sql.gz"
ssh hetzner-read cl-backup >"$file.tmp"
gzip -t "$file.tmp"
mv "$file.tmp" "$file"
ls -t "$dir"/closing-line-*.sql.gz | tail -n +$((keep + 1)) | xargs rm -f
echo "saved $file ($(du -h "$file" | cut -f1))"
