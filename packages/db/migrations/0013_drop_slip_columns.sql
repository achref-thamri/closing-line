DROP INDEX "bets_one_per_coupon";--> statement-breakpoint
ALTER TABLE "bets" DROP COLUMN "competition";--> statement-breakpoint
ALTER TABLE "bets" DROP COLUMN "coupon_id";--> statement-breakpoint
ALTER TABLE "bets" DROP COLUMN "placed_at";--> statement-breakpoint
ALTER TABLE "bets" DROP COLUMN "screenshot_path";