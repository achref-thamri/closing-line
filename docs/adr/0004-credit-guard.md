# 4. A credit guard in front of every paid API call

Date: 2026-11-01. Status: accepted.

## Context

The Odds API's free plan has 500 credits a month and resets on the first (UTC). Each odds call costs one credit for
up to ten named bookmakers. Running out mid-month would stop the scanner and the closing prices of open bets;
a paid plan is a decision for the owner, not for the code.

## Decision

Every paid call goes through `CreditGuard.spend(cost, priority, call)`. The rules are pure functions in
`@closing-line/core`:

- `scan` (routine polls) may spend only today's share: what was left at midnight, minus a reserve, divided by the
  days left in the month;
- `closing` (pre-kickoff polls) may go past that share but never into the reserve;
- `bet` (a person placing a bet) may use the reserve.

The guard records the balance that every response reports in its headers, warns at 70% and 90% usage, and treats
`OUT_OF_USAGE_CREDITS` as a pause until the reset.

## Consequences

- The free plan lasts the month whatever the fixture list looks like; busy weekends cannot drain it.
- Missing balance headers read as zero, which stops paid calls instead of guessing.
- More leagues or more frequent polls need the paid plan, a settings change.
