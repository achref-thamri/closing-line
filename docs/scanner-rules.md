# Why the scanner's rules are set as they are

The settings live in `packages/config/src/schema.ts`. This page gives the evidence for each one. The back-tests use
football-data.co.uk season files: Pinnacle's early price (a day or two before kickoff) de-vigged as the fair price,
the softer books in the file standing in for the Danish-licensed ones, and CLV against Pinnacle's de-vigged closing
price. ADR 0008 describes the back-tester and the first threshold. The figures are what each check found when it
ran; the live CLV has the final say.

## Edge: 2% over Pinnacle's fair price (`scanner.minEdge`)

Chosen by back-test across thresholds from 1% to 3%: every one had positive CLV, and 2% had the best ROI with a
useful number of bets. The table is in ADR 0008.

## At most a week before kickoff (`scanner.maxHoursToKickoff`)

The back-test's prices were taken a day or two before kickoff, so it says nothing about prices further out. After
one refresh produced 22 tips in one minute, most of them 14-18 days out with edges up to 16%, the limit was
set to 72 hours in case those early soft prices were stale.

They weren't. Once they had closed, the 24 scanner bets placed more than 72 hours out averaged +5.1% CLV (18 beat the close),
against +0.3% for the 48 placed later. The `too_early` passes say the same with more matches: 2%+ prices at fair
odds under 5 closed at about +6.0% CLV when taken 3-7 days out (15 prices, 80% beat the close) and +1.2% past a week
(40 prices on 13 matches), next to about +3% inside 72 hours. So the limit is a week. The match-day morning poll
already returns matches that far out, so it costs no credits. Most of the early bets came from one poll, so the
live record still has to confirm this. Past a week stays out because that's where the evidence is weakest.

## No outsiders: fair odds under 5 (`scanner.maxFairOdds`)

Counting every 2%+ value bet at a flat stake over 2021/22 to 2024/25 in the six first live leagues (493 bets): odds
under 5 averaged about +2.8% CLV with three in four beating the close; odds 5-8 averaged -0.6% (58 bets) and 8+
-2.7% (62 bets), with fewer than half beating the close. The first live week agreed: -7.2% CLV on tips at 5+, 3 of
9 beating the close. Pinnacle's early outsider prices move too much to price an edge against.

The quarter-Kelly back-test hardly ever bet these, because the stake rounds to zero, so its tables don't change.
Outsiders got tipped live because the live scanner raised such stakes to the 50 kr minimum.

## A Kelly fraction of 2%, 1% for draws (`scanner.minKellyFraction`)

A 2% edge alone let through bets where Kelly's stake was below the 50 kr minimum and got raised to it. Requiring a
full Kelly fraction of 2% means longer odds need a bigger edge. With Bet365 and bwin as stand-ins for the
Danish-licensed books, over 2021/22 to 2024/25 (fair odds under 5): tips Kelly would bet averaged +5.1% CLV, 91%
beating the close (35 tips); the ones only placed at the minimum averaged -0.3%, 54% (94 tips). Live in the first
week: +4.4% and 76% (29) against -0.8% and 58% (33), and +416 kr against -866 kr. With William Hill and 1xBet in the
file the small edges were still positive, which is why the earlier back-tests didn't show this.

Draws need only 1%. At 2% almost none qualify, since draw odds of 3.3-3.8 then need about a 5% edge, and none did in
the first live week. Over the four past seasons, draws at a Kelly fraction of 1-2% averaged +1.9% CLV (±0.5, 63
tips, 65% beating the close), while home and away tips in the same band averaged -1.8%. Below 1%, draws had no edge
either (-0.2%).

## Stake on the edge a bet keeps (`keptEdge`)

The live scanner stakes Kelly on 70% of the edge seen, at most 3.5%. Same rules as above, Bet365 and bwin against
Pinnacle, 2021/22 to 2024/25 in all eight leagues, leaving out matches with a frozen Pinnacle price: 155 bets kept
58% of their edge on average, CLV +2.3% (±0.9). By the edge seen: 2-3% kept 69% (+1.7% CLV, 68 bets), 3-5% kept 70%
(+2.7%, 59), 5-8% kept 41% (+2.6%, 19), over 8% kept 31% (+3.3%, 9). Every band closed positive, so big edges aren't
capped, just staked as if smaller. Which bets pass doesn't change. The back-test keeps plain `kellyStake`.

## Leagues (`leagues`)

The first back-test picked the Premier League, Championship, Bundesliga and La Liga, with Serie A (21 bets, +4.0%
CLV) and Ligue 1 (22 bets, +4.0%) as good as those four. The Eredivisie, Primeira Liga, Scottish Premiership and
League One were weak or negative. In a later run the Eredivisie and Primeira Liga gave 7 tips each in four seasons,
only 57% beating the close, for about a third more credits.

Second divisions, 2023/24 and 2024/25 at 2%:

| League                         | Bets | Average CLV | Beat the closing price |
| ------------------------------ | ---- | ----------- | ---------------------- |
| Serie B                        | 46   | +2.9%       | 72%                    |
| Segunda División               | 37   | +1.1%       | 60%                    |
| 2. Bundesliga                  | 5    | +6.3%       | 80%                    |
| Ligue 2                        | 13   | -0.8%       | 54%                    |
| Championship (live, for scale) | 12   | +4.5%       | 83%                    |

Serie B is in: the most bets with a clear edge. Segunda División's edge is too thin to be sure of, the 2. Bundesliga
gives too few bets to matter, and Ligue 2 has none.

Six more leagues, same seasons and threshold:

| League               | Bets | Average CLV | Beat the closing price |
| -------------------- | ---- | ----------- | ---------------------- |
| Belgian Pro League   | 24   | +3.5%       | 75%                    |
| Greek Super League   | 16   | +1.8%       | 63%                    |
| Turkish Süper Lig    | 28   | +0.1%       | 57%                    |
| League Two           | 15   | +2.1%       | 60%                    |
| Scottish Premiership | 6    | +3.8%       | 67%                    |
| League One           | 5    | -5.8%       | 20%                    |

Belgium is in: the only one with a clear edge in both seasons (+3.8% and +3.3%). It's about one tip a month, but
Pinnacle and all six Danish-licensed books price its matches. Greece and League Two are too thin to trust, Turkey
has no edge, and Scotland and League One give too few bets.

Serie B and Belgium have no free football-data.org results, so they settle from The Odds API's scores, 2 credits a
day. All eight leagues come to roughly 430 credits a month of the free plan's 500.

## Tested and not added

Over/under 2.5 goals. Same rules as the scanner, Bet365 as the only soft book, 2021/22 to 2024/25 in all eight
leagues (about 12,000 matches). The bar, set before the run: at least +4% CLV, 70% beating the close and about 10
bets a season, since totals roughly double the cost of every poll and would need a paid plan. At first it looked
strong: 23 bets, +8.3% CLV, 87% beating the close, but a -23% return. Nearly all were unders in high-scoring matches
(Bayern, Dortmund) where football-data's Pinnacle 2.5 price sits at about 1.33/3.3 and the closing price is the same
number, while Bet365 and the market average have the under near 4.0. Pinnacle was pricing a higher main line, so its
2.5 figure is stale and both the edge and the CLV are made up. Leaving out the 256 matches where Pinnacle's early
and closing totals are identical leaves 7 bets in four seasons at -1.9% CLV. Bet365 prices totals about as tightly
as Pinnacle, so there is nothing to tip. The 1X2 columns don't have this problem: 3 of 12,110 matches have identical
early and closing Pinnacle prices, and none was bet. Any future check of another market in these files should drop
matches whose Pinnacle price never moves.

Betfair's exchange, as a tip book (+0.6% CLV, 53% beating the close, 17 tips in 2024/25) and as a second sharp
check (no difference whether it agreed with Pinnacle).
