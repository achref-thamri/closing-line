CREATE TYPE "public"."bet_tag" AS ENUM('lineup', 'skewed_price', 'game_read', 'slow_live_price');--> statement-breakpoint
CREATE TYPE "public"."sport" AS ENUM('football', 'counter_strike');--> statement-breakpoint
ALTER TYPE "public"."bet_status" ADD VALUE 'cashed_out';--> statement-breakpoint
DROP INDEX "bets_one_per_selection";--> statement-breakpoint
ALTER TABLE "bets" ALTER COLUMN "fixture_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "sport" "sport" DEFAULT 'football' NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "event_name" text;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "competition" text;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "player_name" text;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "line" double precision;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "tag" "bet_tag";--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "coupon_id" text;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "placed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "other_books_odds" double precision;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "cashout_offer_ore" integer;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "implied_current_odds" double precision;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "held_status" "bet_status";--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "screenshot_path" text;--> statement-breakpoint
CREATE UNIQUE INDEX "bets_one_per_coupon" ON "bets" USING btree ("bookmaker","coupon_id","market","selection") WHERE "bets"."coupon_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "bets_one_per_selection" ON "bets" USING btree ("player_id","fixture_id","market","selection") WHERE not "bets"."self_reported";--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_has_event" CHECK ("bets"."fixture_id" is not null or "bets"."event_name" is not null);--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_cashout_has_offer" CHECK ("bets"."status"::text <> 'cashed_out' or "bets"."cashout_offer_ore" is not null);