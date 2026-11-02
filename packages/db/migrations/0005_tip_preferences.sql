ALTER TABLE "players" ADD COLUMN "bookmakers" text[];--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "tips_muted" boolean DEFAULT false NOT NULL;