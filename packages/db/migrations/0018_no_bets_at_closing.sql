ALTER TYPE "public"."decision_reason" ADD VALUE 'too_late';--> statement-breakpoint
-- Scanner bets placed in the closing window were measured against the price that found them, so their CLV was
-- just their edge. closing_fair_odds and edge_at_bet stay, so the value can be worked out again.
UPDATE "bets" SET "clv" = NULL
FROM "fixtures"
WHERE "bets"."fixture_id" = "fixtures"."id"
  AND "bets"."player_id" = 'scanner'
  AND "fixtures"."kickoff" - "bets"."created_at" <= interval '45 minutes';
