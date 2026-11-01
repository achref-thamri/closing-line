# 3. Pinnacle's de-vigged prices as the fair reference

Date: 2026-11-01. Status: accepted.

## Context

Value means a price better than the true chance of the outcome. The true chance is unknown; the best public
estimate is the price of a bookmaker that takes large bets from winning customers and moves its line quickly.

## Decision

Pinnacle's 1X2 prices, with the margin removed by the power method, are the fair probabilities. A market is judged
only when all three prices are under ten minutes old. Exchange prices are reduced by their commission on winnings
before they are compared, and exchange bets are locked at those net odds.

## Consequences

- The scanner needs no model of its own to find value, and works from day one.
- The power method takes more margin off longshots than the proportional method, which matches how bookmakers
  price; both are implemented and property-tested.
- Pinnacle cannot be used for betting from Denmark; it is a reference only. Its prices in The Odds API come from
  its public site and may lag, hence the freshness rule.
- In efficient markets such as the Premier League, value of 3% or more is rare. That is the expected result, not a
  bug.
