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

- Value bets stay rare: about 65 in 3,236 matches, a few a month across four leagues. The way to more tips is more
  leagues; a lower threshold would give up the edge.
- The samples are small and the soft books differ from the ones we poll, with one early snapshot instead of two
  polls a match day. It is evidence, but the live CLV has the final say.
- 2025/26 can be added, but it says little (checked 2026-11-04). Its files have Pinnacle prices only until mid-January
  2026 (1,158 of 2,304 matches in the six live leagues), and the William Hill and 1xBet columns are empty, so only
  Bet365 and bwin are left as soft books. At 2% that gives 7 bets, +1.1% average CLV. Replaying 2023/24 and 2024/25
  with the same two books gives 21 bets in 4,608 matches, +5.5% CLV: about the same rate of bets per match, so the
  drop comes from the thinner file and says nothing about the market. Seven bets cannot move the threshold, so it
  stays at 2%.
- With four soft books, the same two seasons gave 108 bets; with two, 21. Most value comes from the softer books,
  which is one more reason to add books and leagues.
- The source is getting thinner, so later seasons will add less. The live CLV is what decides from here.
- The back-test's prices were taken a day or two before kickoff, so it says nothing about prices weeks out. Since
  2026-11-06 the scanner only bets and tips matches within 72 hours of kickoff (`scanner.maxHoursToKickoff`); matches
  further out are recorded as `too_early` passes with their best price. This followed a /picks refresh on
  2026-11-04 that produced 22 tips in one minute, most 14-18 days out, with edges up to 16%. The 22 bets stay on the
  books and will show whether those early edges held.
- Since 2026-11-08 the scanner leaves out selections at fair odds of 5 or longer (`scanner.maxFairOdds`). Counting
  every 2%+ value bet at a flat stake over 2021/22 to 2024/25 in the six live leagues (493 bets): odds under 5
  averaged about +2.8% CLV with three in four beating the close; odds 5-8 averaged -0.6% (58 bets) and 8+ -2.7%
  (62 bets), with fewer than half beating the close. The first live week agreed: -7.2% CLV on tips at 5+, 3 of 9
  beating the close. Pinnacle's early outsider prices move too much to price an edge against. The quarter-Kelly
  back-test hardly ever bet these (the stake rounds to zero), so its tables don't change; the live scanner raises
  such stakes to the minimum (#89), which is how outsiders got tipped.
