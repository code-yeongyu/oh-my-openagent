import { integer, jsonb, pgEnum, pgTable, real, text, timestamp } from "drizzle-orm/pg-core"

export const memoryStatusEnum = pgEnum("memory_status", ["active", "archived", "superseded", "pending_review"])
export const sourceKindEnum = pgEnum("source_kind", ["session", "corpus", "manual", "agent"])
export const memoryTypeEnum = pgEnum("memory_type", ["decision", "discovery", "bugfix", "feature", "change", "rule", "convention", "benchmark"])
export const promotionOriginEnum = pgEnum("promotion_origin", ["L1", "L3"])

export const memory = pgTable("memory", {
  memory_id: text("memory_id").primaryKey(),
  project_id: text("project_id").notNull(),
  memory_type: memoryTypeEnum("memory_type").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  why_it_matters: text("why_it_matters").notNull(),
  scope: text("scope").notNull(),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  status: memoryStatusEnum("status").notNull().default("active"),
  confidence: real("confidence").notNull(),
  source_kind: sourceKindEnum("source_kind").notNull(),
  source_refs: jsonb("source_refs").$type<Record<string, string>>().notNull().default({}),
  created_by: text("created_by").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  last_validated_at: timestamp("last_validated_at", { withTimezone: true }),
  promotion_origin: promotionOriginEnum("promotion_origin").notNull(),
  provider_name: text("provider_name").notNull(),
  provider_external_id: text("provider_external_id").notNull(),
  provider_payload_raw: jsonb("provider_payload_raw").$type<Record<string, unknown>>(),
  obsidian_path: text("obsidian_path"),
  related_entities: jsonb("related_entities").$type<string[]>(),
  supersedes: jsonb("supersedes").$type<string[]>(),
  superseded_by: text("superseded_by"),
  content_hash: text("content_hash"),
})

export const memoryContent = pgTable("memory_content", {
  content_id: text("content_id").primaryKey(),
  memory_id: text("memory_id").notNull().references(() => memory.memory_id),
  version: integer("version").notNull().default(1),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  content_hash: text("content_hash").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const memoryProvenance = pgTable("memory_provenance", {
  id: text("id").primaryKey(),
  memory_id: text("memory_id").notNull().references(() => memory.memory_id),
  source_kind: sourceKindEnum("source_kind").notNull(),
  source_refs: jsonb("source_refs").$type<Record<string, string>>().notNull().default({}),
  promotion_origin: promotionOriginEnum("promotion_origin").notNull(),
  promoted_at: timestamp("promoted_at", { withTimezone: true }).notNull().defaultNow(),
  promoted_by: text("promoted_by").notNull(),
  classifier_trace: jsonb("classifier_trace").$type<string[]>().notNull().default([]),
})

export const memorySupersedes = pgTable("memory_supersedes", {
  id: text("id").primaryKey(),
  memory_id: text("memory_id").notNull().references(() => memory.memory_id),
  superseded_memory_id: text("superseded_memory_id").notNull(),
  reason: text("reason").notNull(),
  superseded_at: timestamp("superseded_at", { withTimezone: true }).notNull().defaultNow(),
})

export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "processing", "synced", "failed"])
export const outboxOperationEnum = pgEnum("outbox_operation", ["create", "update", "delete"])

export const memoryOutbox = pgTable("memory_outbox", {
  outbox_id: text("outbox_id").primaryKey(),
  memory_id: text("memory_id").notNull(),
  provider_name: text("provider_name").notNull(),
  operation: outboxOperationEnum("operation").notNull(),
  idempotency_key: text("idempotency_key").notNull().unique(),
  status: outboxStatusEnum("status").notNull().default("pending"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  last_attempted_at: timestamp("last_attempted_at", { withTimezone: true }),
  retry_count: integer("retry_count").notNull().default(0),
  error: text("error"),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
})

export const syncStatusEnum = pgEnum("sync_status", ["synced", "pending", "failed"])

export const memorySyncState = pgTable("memory_sync_state", {
  id: text("id").primaryKey(),
  memory_id: text("memory_id").notNull().references(() => memory.memory_id),
  provider_name: text("provider_name").notNull(),
  last_synced_at: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  last_projected_sha256: text("last_projected_sha256"),
  sync_status: syncStatusEnum("sync_status").notNull().default("pending"),
})

export const memoryProviderMapping = pgTable("memory_provider_mapping", {
  id: text("id").primaryKey(),
  memory_id: text("memory_id").notNull().references(() => memory.memory_id),
  provider_name: text("provider_name").notNull(),
  provider_external_id: text("provider_external_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const auditActionEnum = pgEnum("audit_action", ["created", "updated", "promoted", "superseded", "archived", "synced", "projected"])

export const memoryAuditLog = pgTable("memory_audit_log", {
  audit_id: text("audit_id").primaryKey(),
  memory_id: text("memory_id").notNull(),
  action: auditActionEnum("action").notNull(),
  actor: text("actor").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
