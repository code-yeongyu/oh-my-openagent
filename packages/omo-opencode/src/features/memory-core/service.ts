import { and, asc, desc, eq, gte, ilike, lte, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import type postgres from "postgres"
import { getMemoryDb } from "./db/connection"
import * as schema from "./db/schema"
import type {
  AuditLogEntry,
  CanonicalMemory,
  OutboxEntry,
  PromotionCandidate,
  SyncState,
} from "./types"

export interface MemorySearchOptions {
  project_id?: string
  memory_type?: string
  status?: string
  tags?: string[]
  created_after?: string
  created_before?: string
  limit?: number
  offset?: number
}

export interface MemorySearchResult {
  memories: CanonicalMemory[]
  total: number
}

export interface MemoryCoreServiceDeps {
  databaseUrl: string
}

type MemoryRow = typeof schema.memory.$inferSelect
type OutboxRow = typeof schema.memoryOutbox.$inferSelect
type SyncStateRow = typeof schema.memorySyncState.$inferSelect
type AuditLogRow = typeof schema.memoryAuditLog.$inferSelect

export class MemoryCoreNotImplementedError extends Error {
  constructor(method: string) {
    super(`MemoryCoreService.${method} not yet implemented`)
    this.name = "MemoryCoreNotImplementedError"
  }
}

export class MemoryCoreService {
  private _drizzleDb: ReturnType<typeof drizzle> | undefined

  constructor(private readonly deps: MemoryCoreServiceDeps) {}

  async create(
    memory: Omit<CanonicalMemory, "created_at" | "updated_at">,
  ): Promise<CanonicalMemory> {
    const now = this.now()
    const insertValues = {
      ...this.toMemoryInsert(memory),
      created_at: now,
      updated_at: now,
    }
    const [created] = await this.getDrizzle()
      .insert(schema.memory)
      .values(insertValues)
      .returning()
    return this.mapMemoryRow(created)
  }

  async get(memory_id: string): Promise<CanonicalMemory | undefined> {
    const [memory] = await this.getDrizzle()
      .select()
      .from(schema.memory)
      .where(eq(schema.memory.memory_id, memory_id))
      .limit(1)
    return memory ? this.mapMemoryRow(memory) : undefined
  }

  async update(
    memory_id: string,
    patch: Partial<CanonicalMemory>,
  ): Promise<CanonicalMemory> {
    const updates = this.toMemoryUpdate(patch)
    const [updated] = await this.getDrizzle()
      .update(schema.memory)
      .set({ ...updates, updated_at: this.now() })
      .where(eq(schema.memory.memory_id, memory_id))
      .returning()

    if (!updated) {
      throw new Error(`Memory ${memory_id} not found`)
    }

    return this.mapMemoryRow(updated)
  }

  async archive(memory_id: string): Promise<void> {
    await this.getDrizzle()
      .update(schema.memory)
      .set({ status: "archived", updated_at: this.now() })
      .where(eq(schema.memory.memory_id, memory_id))
  }

  async search(
    query: string,
    options?: MemorySearchOptions,
  ): Promise<MemorySearchResult> {
    const where = this.buildMemoryWhereClause(query, options)
    const db = this.getDrizzle()
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.memory)
      .where(where)
    const rows = await db
      .select()
      .from(schema.memory)
      .where(where)
      .orderBy(desc(schema.memory.updated_at))
      .limit(options?.limit ?? 20)
      .offset(options?.offset ?? 0)

    return {
      memories: rows.map(row => this.mapMemoryRow(row)),
      total: Number(total),
    }
  }

  async listByProject(
    project_id: string,
    options?: MemorySearchOptions,
  ): Promise<MemorySearchResult> {
    return this.search("", { ...options, project_id })
  }

  async enqueueOutbox(
    entry: Omit<OutboxEntry, "created_at" | "retry_count">,
  ): Promise<void> {
    await this.getDrizzle().insert(schema.memoryOutbox).values({
      ...entry,
      created_at: this.now(),
      status: "pending",
      retry_count: 0,
      last_attempted_at: null,
      error: null,
    })
  }

  async getPendingOutbox(
    provider_name: string,
    limit = 100,
  ): Promise<OutboxEntry[]> {
    const rows = await this.getDrizzle()
      .select()
      .from(schema.memoryOutbox)
      .where(
        and(
          eq(schema.memoryOutbox.provider_name, provider_name),
          eq(schema.memoryOutbox.status, "pending"),
        ),
      )
      .orderBy(asc(schema.memoryOutbox.created_at))
      .limit(limit)
    return rows.map(row => this.mapOutboxRow(row))
  }

  async markOutboxSynced(outbox_id: string): Promise<void> {
    await this.getDrizzle()
      .update(schema.memoryOutbox)
      .set({
        status: "synced",
        last_attempted_at: this.now(),
        error: null,
      })
      .where(eq(schema.memoryOutbox.outbox_id, outbox_id))
  }

  async markOutboxFailed(outbox_id: string, error: string): Promise<void> {
    await this.getDrizzle()
      .update(schema.memoryOutbox)
      .set({
        status: "failed",
        error,
        last_attempted_at: this.now(),
        retry_count: sql`${schema.memoryOutbox.retry_count} + 1`,
      })
      .where(eq(schema.memoryOutbox.outbox_id, outbox_id))
  }

  async checkDedup(
    candidate: PromotionCandidate,
  ): Promise<{ isDuplicate: boolean; reason?: string }> {
    const [mapping] = await this.getDrizzle()
      .select()
      .from(schema.memoryProviderMapping)
      .where(eq(schema.memoryProviderMapping.memory_id, candidate.source_memory_id))
      .limit(1)

    if (!mapping) {
      return { isDuplicate: false }
    }

    return {
      isDuplicate: true,
      reason: `Existing ${mapping.provider_name} mapping found for ${candidate.source_memory_id}`,
    }
  }

  async getSyncState(
    memory_id: string,
    provider_name: string,
  ): Promise<SyncState | undefined> {
    const [state] = await this.getDrizzle()
      .select()
      .from(schema.memorySyncState)
      .where(
        and(
          eq(schema.memorySyncState.memory_id, memory_id),
          eq(schema.memorySyncState.provider_name, provider_name),
        ),
      )
      .limit(1)
    return state ? this.mapSyncStateRow(state) : undefined
  }

  async updateSyncState(state: SyncState): Promise<void> {
    const existing = await this.getSyncState(state.memory_id, state.provider_name)
    const values = {
      last_synced_at: new Date(state.last_synced_at),
      last_projected_sha256: state.last_projected_sha256 ?? null,
      sync_status: state.sync_status,
    }

    if (existing) {
      await this.getDrizzle()
        .update(schema.memorySyncState)
        .set(values)
        .where(
          and(
            eq(schema.memorySyncState.memory_id, state.memory_id),
            eq(schema.memorySyncState.provider_name, state.provider_name),
          ),
        )
      return
    }

    await this.getDrizzle().insert(schema.memorySyncState).values({
      id: `${state.memory_id}:${state.provider_name}`,
      memory_id: state.memory_id,
      provider_name: state.provider_name,
      ...values,
    })
  }

  async appendAuditLog(
    entry: Omit<AuditLogEntry, "created_at">,
  ): Promise<void> {
    await this.getDrizzle().insert(schema.memoryAuditLog).values({
      ...entry,
      created_at: this.now(),
    })
  }

  async getAuditLog(memory_id: string): Promise<AuditLogEntry[]> {
    const rows = await this.getDrizzle()
      .select()
      .from(schema.memoryAuditLog)
      .where(eq(schema.memoryAuditLog.memory_id, memory_id))
      .orderBy(desc(schema.memoryAuditLog.created_at))
    return rows.map(row => this.mapAuditLogRow(row))
  }

  private getDrizzle() {
    if (this._drizzleDb) return this._drizzleDb
    const db = getMemoryDb({ url: this.deps.databaseUrl })
    this._drizzleDb = drizzle(db as postgres.Sql, { schema })
    return this._drizzleDb
  }

  private buildMemoryWhereClause(query: string, options?: MemorySearchOptions) {
    const conditions = [
      options?.project_id ? eq(schema.memory.project_id, options.project_id) : undefined,
      options?.memory_type ? eq(schema.memory.memory_type, options.memory_type as typeof schema.memory.$inferSelect.memory_type) : undefined,
      options?.status ? eq(schema.memory.status, options.status as typeof schema.memory.$inferSelect.status) : undefined,
      options?.created_after ? gte(schema.memory.created_at, new Date(options.created_after)) : undefined,
      options?.created_before ? lte(schema.memory.created_at, new Date(options.created_before)) : undefined,
      query.trim()
        ? sql`(${schema.memory.title} ilike ${`%${query}%`} or ${schema.memory.summary} ilike ${`%${query}%`})`
        : undefined,
      ...(options?.tags ?? []).map(tag => sql`${schema.memory.tags}::text ilike ${`%${tag}%`}`),
    ].filter(condition => condition !== undefined)

    return conditions.length > 0 ? and(...conditions) : undefined
  }

  private toMemoryInsert(memory: Omit<CanonicalMemory, "created_at" | "updated_at">) {
    return {
      ...memory,
      last_validated_at: memory.last_validated_at ? new Date(memory.last_validated_at) : null,
      provider_payload_raw: memory.provider_payload_raw ?? null,
      obsidian_path: memory.obsidian_path ?? null,
      related_entities: memory.related_entities ?? null,
      supersedes: memory.supersedes ?? null,
      superseded_by: memory.superseded_by ?? null,
    }
  }

  private toMemoryUpdate(patch: Partial<CanonicalMemory>) {
    const updates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (key === "created_at" || key === "memory_id" || value === undefined) continue
      updates[key] = value
    }
    if ("last_validated_at" in patch) {
      updates.last_validated_at = patch.last_validated_at ? new Date(patch.last_validated_at) : null
    }
    if ("provider_payload_raw" in patch) updates.provider_payload_raw = patch.provider_payload_raw ?? null
    if ("obsidian_path" in patch) updates.obsidian_path = patch.obsidian_path ?? null
    if ("related_entities" in patch) updates.related_entities = patch.related_entities ?? null
    if ("supersedes" in patch) updates.supersedes = patch.supersedes ?? null
    if ("superseded_by" in patch) updates.superseded_by = patch.superseded_by ?? null
    return updates
  }

  private mapMemoryRow(row: MemoryRow): CanonicalMemory {
    return {
      ...row,
      created_at: this.toIsoString(row.created_at),
      updated_at: this.toIsoString(row.updated_at),
      last_validated_at: this.toNullableIsoString(row.last_validated_at),
      provider_payload_raw: row.provider_payload_raw ?? undefined,
      obsidian_path: row.obsidian_path ?? undefined,
      related_entities: row.related_entities ?? undefined,
      supersedes: row.supersedes ?? undefined,
      superseded_by: row.superseded_by ?? undefined,
    }
  }

  private mapOutboxRow(row: OutboxRow): OutboxEntry {
    return {
      outbox_id: row.outbox_id,
      memory_id: row.memory_id,
      provider_name: row.provider_name,
      operation: row.operation,
      idempotency_key: row.idempotency_key,
      status: row.status,
      created_at: this.toIsoString(row.created_at),
      last_attempted_at: this.toNullableIsoString(row.last_attempted_at),
      retry_count: row.retry_count,
      error: row.error ?? undefined,
    }
  }

  private mapSyncStateRow(row: SyncStateRow): SyncState {
    return {
      memory_id: row.memory_id,
      provider_name: row.provider_name,
      last_synced_at: this.toIsoString(row.last_synced_at),
      last_projected_sha256: row.last_projected_sha256 ?? undefined,
      sync_status: row.sync_status,
    }
  }

  private mapAuditLogRow(row: AuditLogRow): AuditLogEntry {
    return {
      audit_id: row.audit_id,
      memory_id: row.memory_id,
      action: row.action,
      actor: row.actor,
      details: row.details,
      created_at: this.toIsoString(row.created_at),
    }
  }

  private toIsoString(value: Date | string) {
    return value instanceof Date ? value.toISOString() : String(value)
  }

  private toNullableIsoString(value: Date | string | null) {
    return value ? this.toIsoString(value) : undefined
  }

  private now() {
    return new Date()
  }
}
