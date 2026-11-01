# 7. The dashboard reads the database directly, with SQL doing the sums

Date: 2026-11-01. Status: accepted.

## Context

The dashboard shows a leaderboard, bankroll charts and the latest bets. It runs on the same server as the worker,
for two people, and must be easy to show to others without real data or API keys. A first version computed each
player's results by loading every bet the player ever made.

## Decision

- Next.js server components read Postgres through the same repositories as the worker. There is no separate API:
  the only consumer is the dashboard itself.
- The dashboard opens the database with `migrate: false`; the worker owns the schema.
- Per-player results come from one aggregate query (`bets.totals`, `count(*) filter` and `sum`), and the rules for
  ROI and average CLV live once in `@closing-line/core` (`statsFromTotals`), shared with the in-memory path used in
  tests. Only the bankroll chart reads rows, and only the columns it plots.
- Without `DATABASE_URL` the dashboard runs on in-memory PGlite filled with deterministic demo data.
- In production it is published on the server's loopback only and opened through an SSH tunnel.
- Styling is Tailwind CSS: zero runtime cost, so pages stay server components (runtime CSS-in-JS such as Emotion
  or Chakra UI needs client components), and dark mode and phone layouts are built-in variants. The few
  components (cards, table, badge) are written by hand; a component library such as shadcn/ui was not worth it
  at this size.

## Consequences

- The cost of a page view and of the scanner's stake sizing no longer grows with each player's history.
- Demo mode makes the dashboard reviewable by anyone, and Playwright tests need nothing external.
- No login code is needed while it is private. Making it public later means HTTPS, a domain and authentication
  (the plan is Telegram login), and a read-only database role for the dashboard.
- An API layer becomes worth it if a second client appears (for example a mobile app).
