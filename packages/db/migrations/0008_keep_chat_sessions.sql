CREATE TYPE "public"."chat_session_kind" AS ENUM('bet_draft', 'join_request', 'cashout');--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"chat_id" bigint NOT NULL,
	"kind" "chat_session_kind" NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_sessions_chat_id_kind_pk" PRIMARY KEY("chat_id","kind")
);
