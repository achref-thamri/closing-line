CREATE TYPE "public"."decision_outcome" AS ENUM('bet', 'pass');--> statement-breakpoint
CREATE TYPE "public"."decision_reason" AS ENUM('value', 'no_edge', 'no_fresh_sharp', 'stake_too_small', 'paused', 'already_bet');--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "decisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fixture_id" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"minutes_to_kickoff" integer NOT NULL,
	"outcome" "decision_outcome" NOT NULL,
	"reason" "decision_reason" NOT NULL,
	"best_selection" text,
	"best_bookmaker" text,
	"best_odds" double precision,
	"best_edge" double precision,
	"fair_home" double precision,
	"fair_draw" double precision,
	"fair_away" double precision,
	CONSTRAINT "decisions_bet_is_value" CHECK (("decisions"."outcome" = 'bet') = ("decisions"."reason" = 'value'))
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_taken_idx" ON "decisions" USING btree ("taken_at");