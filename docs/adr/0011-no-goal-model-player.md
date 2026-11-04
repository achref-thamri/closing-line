# 11. No goal-model player: it does not beat Pinnacle

Date: 2026-11-04. Status: accepted.

## Context

The plan's next step after recording passes (ADR 0010) was our own pre-match model as one more paper player, judged
against Pinnacle like everyone else. Paid live or in-play data would only follow if that model showed an edge. Free
history makes it possible to answer the question before running anything live.

## Decision

`apps/backtest` has a Dixon-Coles goal model: each side's goals are Poisson with a mean set by its attack, the
other side's defence and home advantage, a correction for the four low scores, and older matches weighted down by a
half-life. It is refitted every Monday on that country's earlier results only (both divisions, so promoted teams
have history) and rates the week's matches, which is how it would run live.

On football-data.co.uk from 2020/21 to 2025/26, the top two divisions of England, Spain, Germany, Italy and France
(20,839 matches with Pinnacle prices), with a one-year half-life:

| Forecast       | Log loss, all | First divisions | Second divisions |
| -------------- | ------------- | --------------- | ---------------- |
| Goal model     | 1.0265        | 0.9873          | 1.0619           |
| Pinnacle early | 1.0073        | 0.9702          | 1.0408           |
| Pinnacle close | 1.0047        | 0.9678          | 1.0381           |

Lower is better. The model is well behind Pinnacle's early price, in both tiers. Half-lives of 180 and 730 days and
other strengths of the pull towards an average team changed the model's figure by under 0.007.

Blending the model into the fair price and running the scanner at 2% against the soft books:

| Model share | Bets   | Average CLV | Flat ROI |
| ----------- | ------ | ----------- | -------- |
| 0% (today)  | 1,430  | +2.4%       | +3.9%    |
| 10%         | 1,888  | +1.2%       | -1.2%    |
| 20%         | 4,053  | -1.7%       | -7.0%    |
| 100%        | 20,307 | -5.4%       | -10.0%   |

Every share of the model makes the forecast worse and the bets lose value. Used as a filter instead (only the
scanner's bets the model agrees with), CLV did not improve either.

So the model does not become a live player, and paid live data is not justified by it. Its code was removed from
the back-tester afterwards, since nothing else uses it; commit e724877 has the model and the walk-forward check if
the test is ever rerun.

## Consequences

- The scanner, which borrows Pinnacle's price instead of competing with it, stays the automated player.
- A model built only on goals and dates knows less than the market, which also sees lineups, injuries, shots and
  money. Beating Pinnacle would need that kind of data, most of it paid.
- The 2025/26 files now carry Pinnacle's prices (ADR 0008 found none in them at the time), so the scanner's
  back-test and this check can both grow with each season.
