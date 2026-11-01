# 6. The closing line from our own last Pinnacle snapshot

Date: 2026-11-01. Status: accepted.

## Context

Closing line value compares a bet's odds with the fair price at kickoff. The plan was to take Pinnacle's official
closing odds from football-data.co.uk's CSV files. Their 2026/27 files no longer carry Pinnacle prices: the closing
columns are Bet365, Betfred, BetVictor, Betway, Paddy Power, Sky Bet, the market maximum and average, and the
Betfair Exchange. The files are also updated only a few times a week.

## Decision

The closing price is Pinnacle's de-vigged price in our own last poll before kickoff. That poll's window moved from
35–5 minutes to 15–2 minutes before kickoff, after team news (published an hour before) is priced in. The values
are stored as final (`closing_provisional = false`); the column stays for a better source later.

## Consequences

- Value and CLV are measured against the same reference, Pinnacle, with no second set of team names to match.
- CLV is known minutes before kickoff instead of days later, and costs no extra credits.
- The last 2–15 minutes of market movement are missed. In big leagues prices move little then; this can be
  measured later against the exchange closing prices in the CSV, which stay useful as history for a model.
