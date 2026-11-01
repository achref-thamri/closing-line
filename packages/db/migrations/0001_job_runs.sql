CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "job_runs" (
	"key" text PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"message" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "job_runs_started_idx" ON "job_runs" USING btree ("started_at");