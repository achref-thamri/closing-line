# 8. A 2% edge threshold, chosen by back-testing past seasons

Date: 2026-11-02. Status: accepted.

## Context

The scanner backs a soft bookmaker's price when it beats Pinnacle's de-vigged price by at least `scanner.minEdge`.
It started at 3%, a guess. The owner wanted more tips, and waiting months for live results to judge the
threshold would waste the free data that already exists.

## Decision

`apps/backtest` replays the scanner on football-data.co.uk season files: Pinnacle's early prices (taken a day or
two before kickoff) de-vigged as the fair price, Bet365, bwin, William Hill and 1xBet as the soft books, the live
quarter-Kelly stake rules on a running bankroll, CLV against Pinnacle's de-vigged closing price, settlement on the
score. No credits and no API keys.

On 2023/24 and 2024/25 of the Premier League, Championship, Bundesliga and La Liga (3,236 matches):

| Threshold | Bets | ROI    | Average CLV | Beat the closing price |
| --------- | ---- | ------ | ----------- | ---------------------- |
| 1.0%      | 142  | +4.1%  | +2.4%       | 74%                    |
| 1.5%      | 99   | +10.0% | +2.7%       | 75%                    |
| 2.0%      | 65   | +12.0% | +3.7%       | 80%                    |
| 3.0%      | 29   | +2.8%  | +5.3%       | 86%                    |

Every threshold has positive CLV, so the value is real; 2% has the best ROI with a useful number of bets. The
default is 2%. Per league at 2%, Serie A (21 bets, +4.0% CLV) and Ligue 1 (22 bets, +4.0% CLV) are as good as the
four leagues above; the Eredivisie, Primeira Liga, Scottish Premiership and League One are weak or negative.

## Consequences

- Value bets stay rare: about 65 in 3,236 matches, a few a month across four leagues. More leagues, not a lower
  threshold, is the way to more tips.
- The samples are small and the soft books differ from the ones we poll, with one early snapshot instead of two
  polls a match day. Treat this as evidence, not proof; the live CLV decides in the end.
- Seasons from 2025/26 have no Pinnacle columns, so the back-test cannot be extended forward with this source.
