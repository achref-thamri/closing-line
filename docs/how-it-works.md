# How Closing Line decides and measures a bet

Closing Line never forecasts a match itself. It assumes the sharpest bookmaker knows the real chances best, looks
for other bookmakers that pay more than those chances are worth, and then checks whether the market agreed by the
time the match started. This page walks through one made-up match, with the same maths the code uses
(`packages/core`).

## 1. Odds are probabilities with a margin on top

Decimal odds of 2.60 mean a 100 kr stake returns 260 kr. The probability they imply is 1 / 2.60 = 38.5%.

Say Pinnacle prices a match like this:

| Home | Draw | Away |
| ---- | ---- | ---- |
| 2.60 | 3.40 | 2.90 |

The implied probabilities add up to 38.5% + 29.4% + 34.5% = 102.4%, not 100%. The extra 2.4% is Pinnacle's margin
(`overround`), what it keeps whatever happens. Most bookmakers take 5–8%. Pinnacle takes little and lets winning
bettors stay, so its prices move with the best information in the market. That is why it is the fair
reference ([ADR 0003](adr/0003-pinnacle-as-the-fair-price.md)).

## 2. Remove the margin to get fair probabilities

The margin has to come off before the probabilities mean anything. The simple way divides each by 102.4%. Closing
Line uses the power method instead (`devigPower`): it finds the power k for which the implied probabilities, each
raised to k, add up to exactly 100%. Bookmakers put more of their margin on unlikely outcomes, and the power method
takes more off them too.

|                   | Home  | Draw  | Away  |
| ----------------- | ----- | ----- | ----- |
| Fair probability  | 37.7% | 28.6% | 33.7% |
| Fair odds (1 / p) | 2.66  | 3.49  | 2.97  |

## 3. A bet is value when it pays more than it is worth

Another bookmaker offers 3.10 on the away win. The edge is what a bet returns per krone over many bets like it:

edge = offered odds × fair probability − 1 = 3.10 × 33.7% − 1 = **+4.4%**

The scanner bets when the edge is at least 2% (`minEdge`, chosen by back-testing past seasons:
[ADR 0008](adr/0008-edge-threshold-from-the-back-test.md)). Below that, price noise and stale quotes would swamp it.
It also needs a Pinnacle price no older than ten minutes. Otherwise it passes, and the pass is recorded with its
reason ([ADR 0010](adr/0010-record-every-decision.md)).

Value does not mean the bet will win. The away side still loses about two times in three. It means that over
hundreds of bets like it, the returns beat the stakes.

## 4. Stake by the Kelly criterion, then a quarter of it

Kelly says how much of a bankroll to stake to grow it fastest without going broke: edge / (odds − 1), here
4.4% / 2.10 = 2.1%. Full Kelly swings too hard when the fair probabilities are even slightly off, so the scanner
stakes a quarter of it, never more than 2% of its bankroll, in steps of 10 kr with a 50 kr minimum
(`kellyStake`). On 10,000 kr that is 50 kr here. When a quarter of Kelly comes to less than 50 kr, which happens
with small edges at longer odds, the scanner stakes 50 kr anyway (`scannerStake`), so every value bet it finds is
placed and tipped.

## 5. Judge it by the closing line, not the result

Fifteen minutes before kickoff the scanner reads Pinnacle again. By then team news is in and the professional money
has moved the price. Say Pinnacle now has 2.68 / 3.40 / 2.82: the away side has been backed. With the margin
removed, its fair odds are now 2.88.

closing line value (CLV) = odds taken / fair closing odds − 1 = 3.10 / 2.88 − 1 = **+7.6%**

Positive CLV means the bet was taken at a better price than the market's final, best-informed view. Whether the
away side then wins is mostly luck. Over a few hundred bets, CLV says far more about skill than profit does, which
is why every player here (the scanner, the bettors and the "always the favourite" benchmark) is judged by it first
([ADR 0006](adr/0006-closing-line-from-our-own-snapshot.md)).

## 6. The benchmark

"Always the favourite" backs Pinnacle's favourite in every match at the closing price, with a flat stake. It has no
edge by construction: its CLV sits just below zero and it slowly loses the margin. A player that cannot beat it on
CLV and ROI over hundreds of bets has shown no skill, however good a lucky month looked.

## What this does not do

- It does not predict matches. Its fair price is Pinnacle's, so it can only find bookmakers that are slow or
  generous, not mistakes the whole market makes.
- Player props have no Pinnacle price in the free odds feed, so bettors' prop bets get no CLV except a rough price
  move read from a cash-out.
- Bookmakers often limit accounts that keep beating their prices. A paper record that works may not survive as real
  money at the same stakes.
