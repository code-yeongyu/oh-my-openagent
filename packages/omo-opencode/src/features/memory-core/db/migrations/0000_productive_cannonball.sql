CREATE TYPE "public"."audit_action" AS ENUM('created', 'updated', 'promoted', 'superseded', 'archived', 'synced', 'projected');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('active', 'archived', 'superseded', 'pending_review');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('decision', 'discovery', 'bugfix', 'feature', 'change', 'rule', 'convention', 'benchmark');--> statement-breakpoint
CREATE TYPE "public"."outbox_operation" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'synced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."promotion_origin" AS ENUM('L1', 'L3');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('session', 'corpus', 'manual', 'agent');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('synced', 'pending', 'failed');--> statement-breakpoint
CREATE TABLE "memory" (
	"memory_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"memory_type" "memory_type" NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"scope" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "memory_status" DEFAULT 'active' NOT NULL,
	"confidence" real NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"source_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_validated_at" timestamp with time zone,
	"promotion_origin" "promotion_origin" NOT NULL,
	"provider_name" text NOT NULL,
	"provider_external_id" text NOT NULL,
	"provider_payload_raw" jsonb,
	"obsidian_path" text,
	"related_entities" jsonb,
	"supersedes" jsonb,
	"superseded_by" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "memory_audit_log" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"actor" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_content" (
	"content_id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_outbox" (
	"outbox_id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"provider_name" text NOT NULL,
	"operation" "outbox_operation" NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"payload" jsonb,
	CONSTRAINT "memory_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "memory_provenance" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"source_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"promotion_origin" "promotion_origin" NOT NULL,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_by" text NOT NULL,
	"classifier_trace" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_provider_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"provider_name" text NOT NULL,
	"provider_external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_supersedes" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"superseded_memory_id" text NOT NULL,
	"reason" text NOT NULL,
	"superseded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"provider_name" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_projected_sha256" text,
	"sync_status" "sync_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_content" ADD CONSTRAINT "memory_content_memory_id_memory_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("memory_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_provenance" ADD CONSTRAINT "memory_provenance_memory_id_memory_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("memory_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_provider_mapping" ADD CONSTRAINT "memory_provider_mapping_memory_id_memory_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("memory_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_supersedes" ADD CONSTRAINT "memory_supersedes_memory_id_memory_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("memory_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_sync_state" ADD CONSTRAINT "memory_sync_state_memory_id_memory_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("memory_id") ON DELETE no action ON UPDATE no action;