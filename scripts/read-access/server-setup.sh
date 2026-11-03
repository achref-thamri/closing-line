#!/usr/bin/env bash
# Server half of read-only access; install.sh runs it over the owner's own SSH key:
#   ssh hetzner 'bash -s -- "<public key>"' < server-setup.sh
# - Postgres role `reader`: can only SELECT, every transaction read-only, queries stop after 30 seconds.
# - ~/bin/db-read: SQL on stdin, run as `reader`.
# - ~/bin/cl-logs [worker|web|postgres|backup] [30m|2h]: recent container logs.
# - ~/bin/read-gate: forced command for the read-only key, which may run those two and nothing else.
# Safe to run again.
set -euo pipefail
public_key=${1:?public key required}
[[ $public_key =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]] || { echo "not an ed25519 public key" >&2; exit 64; }

cd "$HOME/closing-line"
docker compose exec -T postgres psql -U closing_line -d closing_line -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
begin
    if not exists (select from pg_roles where rolname = 'reader') then
        create role reader login;
    end if;
end
$$;
alter role reader set default_transaction_read_only = on;
alter role reader set statement_timeout = '30s';
grant connect on database closing_line to reader;
grant usage on schema public to reader;
grant select on all tables in schema public to reader;
-- Tables from later migrations are readable too.
alter default privileges for role closing_line in schema public grant select on tables to reader;
SQL

mkdir -p "$HOME/bin"
cat >"$HOME/bin/db-read" <<'SCRIPT'
#!/usr/bin/env bash
# Read-only SQL against Closing Line's database: SQL on stdin, run as the `reader` role.
set -euo pipefail
cd "$HOME/closing-line"
exec docker compose exec -T postgres psql -U reader -d closing_line -v ON_ERROR_STOP=1 -P pager=off
SCRIPT
cat >"$HOME/bin/cl-logs" <<'SCRIPT'
#!/usr/bin/env bash
# Recent logs of a Closing Line container: cl-logs [service] [since]; the worker over the last hour by default.
set -euo pipefail
service=${1:-worker}
since=${2:-1h}
[[ $service =~ ^(worker|web|postgres|backup)$ ]] || { echo "unknown service: $service" >&2; exit 64; }
[[ $since =~ ^[0-9]{1,3}[mh]$ ]] || { echo "since must look like 30m or 2h" >&2; exit 64; }
cd "$HOME/closing-line"
exec docker compose logs --no-color --since "$since" "$service"
SCRIPT
cat >"$HOME/bin/read-gate" <<'SCRIPT'
#!/usr/bin/env bash
# Forced command for the read-only SSH key: whatever the client asks for, only db-read and cl-logs run. The request
# is split into words, never passed to a shell.
set -euo pipefail
read -r -a words <<<"${SSH_ORIGINAL_COMMAND:-}"
case "${words[0]:-}" in
    db-read)
        ((${#words[@]} == 1)) || { echo "db-read takes SQL on stdin, no arguments" >&2; exit 64; }
        exec "$HOME/bin/db-read"
        ;;
    cl-logs)
        ((${#words[@]} <= 3)) || { echo "cl-logs [service] [since]" >&2; exit 64; }
        exec "$HOME/bin/cl-logs" "${words[@]:1}"
        ;;
    *)
        echo "this key may only run db-read or cl-logs" >&2
        exit 64
        ;;
esac
SCRIPT
chmod 755 "$HOME/bin/db-read" "$HOME/bin/cl-logs" "$HOME/bin/read-gate"

entry="command=\"$HOME/bin/read-gate\",restrict $public_key"
touch "$HOME/.ssh/authorized_keys"
grep -qxF "$entry" "$HOME/.ssh/authorized_keys" || printf '%s\n' "$entry" >>"$HOME/.ssh/authorized_keys"

echo "select current_user as role, current_setting('transaction_read_only') as read_only" | "$HOME/bin/db-read"
