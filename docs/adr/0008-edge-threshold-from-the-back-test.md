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
- 2025/26 can be added, but it says little (checked 2026-11-04). Its files have Pinnacle prices only until mid-January
  2026 (1,158 of 2,304 matches in the six live leagues), and the William Hill and 1xBet columns are empty, so only
  Bet365 and bwin are left as soft books. At 2% that gives 7 bets, +1.1% average CLV. Replaying 2023/24 and 2024/25
  with the same two books gives 21 bets in 4,608 matches, +5.5% CLV: about the same rate of bets per match, so the
  drop comes from the thinner file, not from the market. Seven bets cannot move the threshold, so it stays at 2%.
- With four soft books, the same two seasons gave 108 bets; with two, 21. Most value comes from the softer books,
  which is another reason why more books and leagues, not a lower threshold, is the way to more tips.
- The source is getting thinner, so later seasons will add less. The live CLV is what decides from here.
