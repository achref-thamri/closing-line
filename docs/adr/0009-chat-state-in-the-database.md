# 9. Telegram conversations in progress live in the database

Date: 2026-11-03. Status: accepted.

## Context

Logging a bet takes about eight answers in Telegram, and settling a cash-out takes two. The worker kept the answers
so far, pending join requests and the bet waiting for its cash-out amount in memory. `main` deploys itself after
every green CI run, so a merge while someone was halfway through `/log` threw their answers away without telling
them, and a join request sent before a restart lost the person's name.

## Decision

- A `chat_sessions` table holds one row per chat and kind (`bet_draft`, `join_request`, `cashout`), with the value
  as JSON and the time of the last answer. The flows read and write it on every message; there is no cache.
- The flows check a stored value with zod when they read it. A row that no longer fits (written by an older version
  of the flow) is deleted and the person starts again, instead of the flow failing on it.
- A bet draft still expires an hour after its last answer, now measured from the stored time.
- `chat_id` is a `bigint`, because Telegram group ids go beyond 32 bits.

## Consequences

- Deploys and crashes no longer lose half-entered bets, join requests or cash-outs.
- Each message costs one or two small primary-key queries, which is nothing at this volume.
- Changing the shape of a draft needs no migration: old rows are dropped on read, at worst asking one person to
  start a bet again.
- The worker is still the only process that talks to Telegram, so two writers racing on the same row is not a
  concern; it would be if the bot ever ran as more than one instance.
