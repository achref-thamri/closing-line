# 12. The scanner's go-live check counts only bets today's rules would place

Date: 2026-11-16. Status: accepted.

## Context

The go-live rule (300 settled bets over at least three months, positive average CLV, an ROI above the favourite
benchmark, a drawdown under 30% of the start, no unexplained bugs in the last 30 days) was set on 1 November, before
the scanner's rules settled down. Since then it gained a limit on how long before kickoff it bets, an outsider cap at
fair odds of 5 and a minimum Kelly fraction. Bets placed before those rules, like the 4 November
run of tips up to 18 days out, are not the strategy real money would follow. Counting them would judge a scanner
that no longer exists.

## Decision

- For the value scanner, the go-live check counts only settled bets that today's rules would still place
  (`meetsScannerRules` in core: a bookmaker still polled, the time before kickoff, not in the closing window, the fair
  odds cap and the Kelly minimum, as described in [docs/scanner-rules.md](../scanner-rules.md)).
- The dashboard shows the check at the top, each rule met or not, with average CLV and its 95% range. The
  all-time figures stay on the scanner's card next to the today's-rules CLV, and older bets are marked "old rules" in
  the table. Nothing is deleted or rewritten.
- Other players are judged on all their bets.
- "No unexplained bugs in the last 30 days" is still checked by hand.

## Consequences

- The count toward 300 is lower than the scanner's total, so going live takes a little longer.
- A future rule change moves bets out of (or into) the count. That is deliberate: the check always describes the
  scanner as it runs now. A change that drops many bets should be weighed with this in mind.
- The dashboard reads the rules from the config defaults, not the worker's settings file.
