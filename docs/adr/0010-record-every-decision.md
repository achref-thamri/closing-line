# 10. Record every decision, passes included

Date: 2026-11-03. Status: accepted.

## Context

The scanner only left a trace when it bet. Every match it looked at and skipped was gone, so there was no way to
say how often it bets, why it passes, whether passing was right, or whether Pinnacle's fair probabilities are
well calibrated. A system that is comfortable saying "pass, no edge" needs its passes measured as carefully as
its bets.

## Decision

- Each poll writes one `decisions` row per match the scanner looked at: `bet` or `pass`, a reason (`value`,
  `no_edge`, `no_fresh_sharp`, `stake_too_small`, `paused`, `already_bet`), the minutes to kickoff, the best soft
  price on any selection with its edge (value or not), and Pinnacle's fair home, draw and away probabilities.
- A CHECK keeps `bet` and `value` together, so the outcome and the reason cannot disagree.
- Matches already started are not decisions and are not recorded.
- The rows come from data the poll already has: no extra API calls or credits.

## Consequences

- The Monday report shows the bet rate, the pass reasons, and how backing the best price on every no-edge pass
  would have done on settled matches (a loss there means passing was right).
- Calibration (do 55% favourites win 55% of the time?) and breakdowns by league and time to kickoff can be read
  from the same rows, joined to fixture results.
- The table grows by roughly one row per match per poll, a few thousand rows a month; it needs no partitioning.
