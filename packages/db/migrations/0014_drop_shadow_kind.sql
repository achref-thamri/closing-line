ALTER TABLE "players" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."player_kind";--> statement-breakpoint
CREATE TYPE "public"."player_kind" AS ENUM('bettor', 'scanner', 'benchmark');--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "kind" SET DATA TYPE "public"."player_kind" USING "kind"::"public"."player_kind";