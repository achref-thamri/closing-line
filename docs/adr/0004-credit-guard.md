# 4. A credit guard in front of every paid API call

Date: 2026-11-01. Status: accepted.

## Context

The Odds API's free plan has 500 credits a month and resets on the first (UTC). Each odds call costs one credit for
up to ten named bookmakers. Running out mid-month would stop the scanner and the closing prices of open bets;
and paying for a bigger plan is a manual decision, not something the code should do.

## Decision

Every paid call goes through `CreditGuard.spend(cost, priority, call)`. The rules are pure functions in
`@closing-line/core`:

- `scan` (routine polls) may spend only today's share: what was left at midnight, minus a reserve, divided by the
  days left in the month;
- `closing` (pre-kickoff polls and the daily scores call for leagues without free results) may go past that share
  and use the reserve, down to zero.

Until 2026-11-16 the reserve was kept for a `bet` priority, people asking for prices in Telegram, and `closing` stopped
at it. Nothing asks for prices any more (`/picks` was removed), so the reserve now protects what matters most when a
month runs short: the closing prices that measure CLV and the scores that settle bets already placed.

The guard records the balance that every response reports in its headers, warns at 70% and 90% usage, and treats
`OUT_OF_USAGE_CREDITS` as a pause until the reset.

## Consequences

- The free plan lasts the month whatever the fixture list looks like; busy weekends cannot drain it.
- Missing balance headers read as zero, which stops paid calls instead of guessing.
- More leagues or more frequent polls need the paid plan, a settings change.
