CREATE TYPE "public"."bet_status" AS ENUM('open', 'won', 'lost', 'void');--> statement-breakpoint
CREATE TYPE "public"."fixture_status" AS ENUM('scheduled', 'finished', 'void');--> statement-breakpoint
CREATE TYPE "public"."player_kind" AS ENUM('human', 'scanner', 'shadow', 'benchmark');--> statement-breakpoint
CREATE TYPE "public"."snapshot_kind" AS ENUM('poll', 'on_demand', 'closing');--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"provider" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"used" integer NOT NULL,
	"remaining" integer NOT NULL,
	"last_cost" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"fixture_id" text NOT NULL,
	"market" text NOT NULL,
	"selection" text NOT NULL,
	"stake_ore" integer NOT NULL,
	"locked_odds" double precision NOT NULL,
	"bookmaker" text NOT NULL,
	"fair_price_entered" double precision,
	"sharp_fair_odds_at_bet" double precision,
	"edge_at_bet" double precision,
	"reason_tags" text[] DEFAULT '{}' NOT NULL,
	"note" text,
	"would_bet_real" boolean,
	"self_reported" boolean DEFAULT false NOT NULL,
	"status" "bet_status" DEFAULT 'open' NOT NULL,
	"closing_fair_odds" double precision,
	"closing_provisional" boolean,
	"clv" double precision,
	"profit_ore" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "bets_stake_positive" CHECK ("bets"."stake_ore" > 0),
	CONSTRAINT "bets_odds_above_one" CHECK ("bets"."locked_odds" > 1),
	CONSTRAINT "bets_settled_consistently" CHECK (("bets"."status" = 'open') = ("bets"."settled_at" is null))
);
--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" text PRIMARY KEY NOT NULL,
	"league" text NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"kickoff" timestamp with time zone NOT NULL,
	"status" "fixture_status" DEFAULT 'scheduled' NOT NULL,
	"home_goals" integer,
	"away_goals" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixtures_score_when_finished" CHECK (("fixtures"."status" = 'finished') = ("fixtures"."home_goals" is not null and "fixtures"."away_goals" is not null))
);
--> statement-breakpoint
CREATE TABLE "odds_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "odds_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fixture_id" text NOT NULL,
	"bookmaker" text NOT NULL,
	"market" text NOT NULL,
	"selection" text NOT NULL,
	"price" double precision NOT NULL,
	"bookmaker_updated_at" timestamp with time zone NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"kind" "snapshot_kind" NOT NULL,
	CONSTRAINT "odds_snapshots_price_above_one" CHECK ("odds_snapshots"."price" > 1)
);
--> statement-breakpoint
CREATE TABLE "passes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"fixture_id" text NOT NULL,
	"market" text NOT NULL,
	"selection" text,
	"fair_price_entered" double precision,
	"reason_tags" text[] DEFAULT '{}' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "player_kind" NOT NULL,
	"starting_bankroll_ore" integer NOT NULL,
	"telegram_chat_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_usage_provider_taken_idx" ON "api_usage" USING btree ("provider","taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bets_one_per_selection" ON "bets" USING btree ("player_id","fixture_id","market","selection");--> statement-breakpoint
CREATE INDEX "bets_open_idx" ON "bets" USING btree ("fixture_id") WHERE "bets"."status" = 'open';--> statement-breakpoint
CREATE INDEX "fixtures_kickoff_idx" ON "fixtures" USING btree ("kickoff");--> statement-breakpoint
CREATE INDEX "odds_snapshots_fixture_taken_idx" ON "odds_snapshots" USING btree ("fixture_id","taken_at");