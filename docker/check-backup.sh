#!/bin/sh
# Proves a backup restores: loads the newest nightly dump (or, before the first one, a fresh dump made the same
# way) into a scratch database, compares row counts with the live database, and drops the scratch copy.
# Run on the server:  docker compose exec -T backup sh -s < docker/check-backup.sh
set -eu
SCRATCH=restore_check

dump=$(ls -t /backups/closing-line-*.sql.gz 2>/dev/null | head -n 1 || true)
if [ -z "$dump" ]; then
    dump=/tmp/closing-line-check.sql.gz
    pg_dump --no-owner | gzip > "$dump"
    echo "no nightly backup yet; made a fresh dump the same way"
fi
echo "restoring $dump ($(du -h "$dump" | cut -f1))"

psql -q -d postgres -c "drop database if exists $SCRATCH" -c "create database $SCRATCH"
trap 'psql -q -d postgres -c "drop database if exists $SCRATCH"' EXIT
gunzip -c "$dump" | psql -q -v ON_ERROR_STOP=1 -d "$SCRATCH" > /dev/null

tables=$(psql -tA -c "select tablename from pg_tables where schemaname = 'public' order by tablename")
status=0
for table in $tables; do
    live=$(psql -tA -c "select count(*) from \"$table\"")
    restored=$(psql -tA -d "$SCRATCH" -c "select count(*) from \"$table\"")
    note=""
    # Rows written after the dump was taken are expected; fewer rows than at dump time are not.
    if [ "$restored" -gt "$live" ]; then note="  <- more rows than live"; status=1; fi
    printf '%-16s live %8s  restored %8s%s\n' "$table" "$live" "$restored" "$note"
done
migrations=$(psql -tA -d "$SCRATCH" -c "select count(*) from drizzle.__drizzle_migrations")
echo "migrations in the restored copy: $migrations"
[ "$status" -eq 0 ] && echo "restore check passed" || echo "restore check FAILED" >&2
exit "$status"
