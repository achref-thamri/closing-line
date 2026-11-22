#!/usr/bin/env bash
# Copies the newest nightly dump to this Mac over the read-only key and keeps the last 8, so a lost server doesn't
# take the only backups with it. Run weekly (install.sh schedules it):  bash scripts/read-access/pull-backup.sh
# With a healthchecks.io URL in ~/Backups/closing-line/.ping-url, each run reports success or failure there.
set -euo pipefail
dir="$HOME/Backups/closing-line"
keep=8
mkdir -p "$dir"
ping_url=$(cat "$dir/.ping-url" 2>/dev/null || true)
report() { [[ -z $ping_url ]] || curl -fsS -m 10 -o /dev/null "$ping_url$1" || true; }
trap 'report /fail' ERR

file="$dir/closing-line-$(date +%F).sql.gz"
ssh hetzner-read cl-backup >"$file.tmp"
gzip -t "$file.tmp"
newest=$(ls -t "$dir"/closing-line-*.sql.gz 2>/dev/null | head -n 1 || true)
if [[ -n $newest ]] && cmp -s "$file.tmp" "$newest"; then
    rm -f "$file.tmp"
    if (($(date +%s) - $(stat -f %m "$newest") > 36 * 3600)); then
        echo "the server's newest dump is the same as $newest: its nightly backups have stopped" >&2
        report /fail
        exit 1
    fi
    echo "already have the newest dump: $newest"
    report ""
    exit 0
fi
mv "$file.tmp" "$file"
ls -t "$dir"/closing-line-*.sql.gz | tail -n +$((keep + 1)) | xargs rm -f
echo "saved $file ($(du -h "$file" | cut -f1))"
report ""
