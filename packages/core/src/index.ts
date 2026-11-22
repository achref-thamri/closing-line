export { crossedUsageLevels, daysLeftInMonth, decideCredits } from "./credits.ts";
export type { CreditDecision, CreditPriority, CreditState } from "./credits.ts";
export { devigPower } from "./devig.ts";
export {
    bestOffer,
    brokenScannerRule,
    fairProbabilities,
    favourite,
    findValueBets,
    meetsScannerRules,
    netOdds,
} from "./scanner.ts";
export type { BrokenScannerRule, PriceQuote, ScannerRuleBet, ScannerRules, ValueBet, ValueOffer } from "./scanner.ts";
export { availableFromTotals, bankrollSeries, playerStats, statsFromTotals, totalsOf } from "./metrics.ts";
export type { BankrollPoint, MetricsBet, PlayerStats, PlayerTotals } from "./metrics.ts";
export { dueJobs } from "./schedule.ts";
export type { JobKind, PlanInput, PlannedJob, UpcomingFixture } from "./schedule.ts";
export { heldProfitOre, isOutcome, OUTCOMES, outcomeOf, settle1x2, settlesFromScore, toOutcome } from "./settlement.ts";
export type { BetStatus, MatchResult, Outcome, Settlement } from "./settlement.ts";
export { fixtureNamed, matchFixture, teamsOf } from "./teams.ts";
export type { ResultCandidate } from "./teams.ts";
export { kellyStake, scannerStake } from "./staking.ts";
export { toOre } from "./money.ts";
export type { StakeRules } from "./staking.ts";
export { closingLineValue, edge, followerFill, minimumOdds, tipLifetime } from "./value.ts";
export type { FollowerFill, LaterPrice, SnapshotKind, TipLifetime } from "./value.ts";
export { cashoutGainOre, impliedOddsFromCashout, priceMove, statsBy } from "./slips.ts";
export type { SlipStatus } from "./slips.ts";
export { bookName, pickText, sideName } from "./picks.ts";
export { calibration, forecastScores } from "./calibration.ts";
export type { CalibrationBand, Forecast, MatchForecast } from "./calibration.ts";
export { GO_LIVE, goLiveCheck, meanWithRange } from "./goLive.ts";
export type { GoLiveBet, GoLiveCheck, GoLiveItem, MeanWithRange } from "./goLive.ts";
