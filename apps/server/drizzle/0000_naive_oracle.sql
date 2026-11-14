CREATE TABLE "ad_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"placement" text NOT NULL,
	"status" text NOT NULL,
	"day" text NOT NULL,
	"created_at" bigint NOT NULL,
	"rewarded_at" bigint
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" text,
	"session_id" text,
	"type" text NOT NULL,
	"props" jsonb,
	"ts" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" text PRIMARY KEY NOT NULL,
	"segment" jsonb NOT NULL,
	"text" jsonb NOT NULL,
	"button" jsonb,
	"scheduled_at" bigint NOT NULL,
	"status" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_scores" (
	"event_id" text NOT NULL,
	"player_id" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_scores_event_id_player_id_pk" PRIMARY KEY("event_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "ghosts" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" text,
	"name" text NOT NULL,
	"stage" integer NOT NULL,
	"power" integer NOT NULL,
	"build" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" jsonb NOT NULL,
	"body" jsonb NOT NULL,
	"reward" jsonb,
	"created_at" bigint NOT NULL,
	"claimed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "kraken_claims" (
	"kraken_id" text NOT NULL,
	"player_id" text NOT NULL,
	"pct" integer NOT NULL,
	CONSTRAINT "kraken_claims_kraken_id_player_id_pct_pk" PRIMARY KEY("kraken_id","player_id","pct")
);
--> statement-breakpoint
CREATE TABLE "kraken_hits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kraken_id" text NOT NULL,
	"player_id" text NOT NULL,
	"damage" integer NOT NULL,
	"day" text NOT NULL,
	"ts" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"starts_at" bigint NOT NULL,
	"ends_at" bigint NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"chat_id" bigint NOT NULL,
	"text" text NOT NULL,
	"button" jsonb,
	"status" text NOT NULL,
	"kind" text NOT NULL,
	"broadcast_id" text,
	"not_before" bigint NOT NULL,
	"claimed_at" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" bigint NOT NULL,
	"done_at" bigint
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"product_id" text NOT NULL,
	"stars" integer NOT NULL,
	"status" text NOT NULL,
	"charge_id" text,
	"granted" jsonb,
	"created_at" bigint NOT NULL,
	"paid_at" bigint,
	"refunded_at" bigint,
	CONSTRAINT "payments_charge_id_unique" UNIQUE("charge_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"tg_id" bigint,
	"guest_hash" text,
	"name" text NOT NULL,
	"lang" text DEFAULT 'ru' NOT NULL,
	"guest" boolean DEFAULT true NOT NULL,
	"profile" jsonb NOT NULL,
	"quests" jsonb,
	"cosmetics" jsonb NOT NULL,
	"pass" jsonb NOT NULL,
	"perks" jsonb NOT NULL,
	"notify" jsonb NOT NULL,
	"last_build" jsonb,
	"trophies" integer DEFAULT 0 NOT NULL,
	"bot_blocked" boolean DEFAULT false NOT NULL,
	"referrer_id" text,
	"paid_stars" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	CONSTRAINT "players_tg_id_unique" UNIQUE("tg_id"),
	CONSTRAINT "players_guest_hash_unique" UNIQUE("guest_hash")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"invitee_id" text PRIMARY KEY NOT NULL,
	"referrer_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"slot" integer DEFAULT 0 NOT NULL,
	"state" jsonb NOT NULL,
	"status" text NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"last_response" jsonb,
	"hunt_started_at" bigint,
	"started_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"hero_id" text NOT NULL,
	"stage_reached" integer DEFAULT 1 NOT NULL,
	"result" text,
	"event_id" text,
	"rewards" jsonb
);
--> statement-breakpoint
CREATE INDEX "ad_intents_player_idx" ON "ad_intents" USING btree ("player_id","day");--> statement-breakpoint
CREATE INDEX "analytics_type_idx" ON "analytics_events" USING btree ("type","ts");--> statement-breakpoint
CREATE INDEX "analytics_player_idx" ON "analytics_events" USING btree ("player_id","ts");--> statement-breakpoint
CREATE INDEX "event_scores_rank_idx" ON "event_scores" USING btree ("event_id","score");--> statement-breakpoint
CREATE UNIQUE INDEX "ghosts_player_stage_idx" ON "ghosts" USING btree ("player_id","stage");--> statement-breakpoint
CREATE INDEX "ghosts_stage_power_idx" ON "ghosts" USING btree ("stage","power");--> statement-breakpoint
CREATE INDEX "inbox_player_idx" ON "inbox" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "kraken_hits_idx" ON "kraken_hits" USING btree ("kraken_id","player_id");--> statement-breakpoint
CREATE INDEX "live_events_kind_idx" ON "live_events" USING btree ("kind","starts_at");--> statement-breakpoint
CREATE INDEX "outbox_queue_idx" ON "outbox" USING btree ("status","not_before");--> statement-breakpoint
CREATE INDEX "outbox_broadcast_idx" ON "outbox" USING btree ("broadcast_id");--> statement-breakpoint
CREATE INDEX "payments_player_idx" ON "payments" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "players_trophies_idx" ON "players" USING btree ("trophies");--> statement-breakpoint
CREATE INDEX "players_seen_idx" ON "players" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_active_slot_idx" ON "runs" USING btree ("player_id","slot") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "runs_player_idx" ON "runs" USING btree ("player_id","started_at");