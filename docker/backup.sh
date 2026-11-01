#!/bin/sh
# Nightly compressed pg_dump at BACKUP_HOUR (UTC), keeping BACKUP_DAYS days. Runs in the postgres image.
set -eu
: "${BACKUP_HOUR:=3}" "${BACKUP_DAYS:=14}"
mkdir -p /backups
while true; do
    now=$(date -u +%s)
    next=$(date -u -d "$(date -u +%F) ${BACKUP_HOUR}:00" +%s)
    [ "$next" -gt "$now" ] || next=$((next + 86400))
    sleep $((next - now))
    file="/backups/closing-line-$(date -u +%F).sql.gz"
    if pg_dump --no-owner | gzip > "$file.tmp"; then
        mv "$file.tmp" "$file"
        find /backups -name 'closing-line-*.sql.gz' -mtime +"$BACKUP_DAYS" -delete
        echo "backup written: $file"
    else
        rm -f "$file.tmp"
        echo "backup failed" >&2
    fi
done
