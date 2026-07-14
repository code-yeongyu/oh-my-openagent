/**
 * CRUD for memories, memory_embeddings, and memory_verifications.
 *
 * Ported from MC's memory/storage-memory.ts,
 * memory/storage-memory-embeddings.ts, and
 * memory/storage-memory-verifications.ts.
 */

import type { Database } from "../sqlite"

// ── Types (mirroring MC's memory/types.ts) ─────────────────────

export type MemoryCategory =
  | "ARCHITECTURE"
  | "ARCHITECTURE_DECISIONS"
  | "CONFIG_VALUES"
  | "CONFIG_DEFAULTS"
  | "CONSTRAINTS"
  | "ENVIRONMENT"
  | "KNOWN_ISSUES"
  | "NAMING"
  | "USER_DIRECTIVES"
  | "USER_PREFERENCES"
  | "WORKFLOW_RULES"
  | "PROJECT_RULES"

export type MemoryStatus = "active" | "permanent" | "archived"
export type MemoryScope = "project" | "ecosystem" | "universe"
export type MemorySourceType =
  | "historian"
  | "agent"
  | "dreamer"
  | "user"
export type VerificationStatus =
  | "unverified"
  | "verified"
  | "stale"
  | "flagged"

export interface Memory {
  id: number
  projectPath: string
  category: MemoryCategory
  content: string
  normalizedHash: string
  importance: number
  scope: MemoryScope
  shareable: number
  sourceSessionId: string | null
  sourceType: MemorySourceType
  seenCount: number
  retrievalCount: number
  firstSeenAt: number
  createdAt: number
  updatedAt: number
  lastSeenAt: number
  lastRetrievedAt: number | null
  status: MemoryStatus
  expiresAt: number | null
  verificationStatus: VerificationStatus
  verifiedAt: number | null
  supersededByMemoryId: number | null
  mergedFrom: string | null
  metadataJson: string | null
}

export interface MemoryInput {
  projectPath: string
  category: MemoryCategory
  content: string
  importance?: number | null
  sourceSessionId?: string | null
  sourceType?: MemorySourceType
  expiresAt?: number | null
  metadataJson?: string | null
}

export interface StoredMemoryEmbedding {
  embedding: Float32Array
  modelId: string | null
}

export interface MemoryVerificationState {
  files: string[]
  hasSentinel: boolean
  verifiedAt: number
  mappedAt: number
}

// ── Memories — Insert / Get / List / Update / Delete ──────────

export function insertMemory(
  db: Database,
  input: MemoryInput,
): Memory {
  const now = Date.now()
  const normalizedHash = computeNormalizedHash(input.content)

  const result = db
    .prepare(
      `INSERT INTO memories
        (project_path, category, content, normalized_hash, importance,
         source_session_id, source_type, seen_count, retrieval_count,
         first_seen_at, created_at, updated_at, last_seen_at,
         last_retrieved_at, status, expires_at,
         verification_status, verified_at,
         superseded_by_memory_id, merged_from, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.projectPath,
      input.category,
      input.content,
      normalizedHash,
      input.importance ?? 50,
      input.sourceSessionId ?? null,
      input.sourceType ?? "historian",
      1,
      0,
      now,
      now,
      now,
      now,
      null,
      "active",
      input.expiresAt ?? null,
      "unverified",
      null,
      null,
      null,
      input.metadataJson ?? null,
    ) as { lastInsertRowid?: number | bigint }

  const inserted = getMemoryById(db, Number(result.lastInsertRowid))
  if (!inserted) {
    throw new Error("Failed to load inserted memory row")
  }
  return inserted
}

export function insertMemoryIdempotent(
  db: Database,
  input: MemoryInput,
): { memory: Memory; inserted: boolean } {
  try {
    return { memory: insertMemory(db, input), inserted: true }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const normalizedHash = computeNormalizedHash(input.content)
    const existing = getMemoryByHash(
      db,
      input.projectPath,
      input.category,
      normalizedHash,
    )
    if (!existing) throw error
    updateMemorySeenCount(db, existing.id)
    return {
      memory: getMemoryById(db, existing.id) ?? existing,
      inserted: false,
    }
  }
}

export function getMemoryById(
  db: Database,
  id: number,
): Memory | null {
  const row = db
    .prepare("SELECT * FROM memories WHERE id = ?")
    .get(id)
  return isMemoryRow(row) ? toMemory(row) : null
}

export function getMemoryByHash(
  db: Database,
  projectPath: string,
  category: string,
  normalizedHash: string,
): Memory | null {
  const row = db
    .prepare(
      "SELECT * FROM memories WHERE project_path = ? AND category = ? AND normalized_hash = ?",
    )
    .get(projectPath, category, normalizedHash)
  return isMemoryRow(row) ? toMemory(row) : null
}

export function getMemoriesByProject(
  db: Database,
  projectPath: string,
  statuses: MemoryStatus[] = ["active", "permanent"],
  expiryCutoff: number = Date.now(),
): Memory[] {
  if (statuses.length === 0) return []
  const placeholders = statuses.map(() => "?").join(", ")
  const rows = (
    db
      .prepare(
        `SELECT * FROM memories
         WHERE project_path = ?
           AND status IN (${placeholders})
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY category ASC, updated_at DESC, id ASC`,
      )
      .all(projectPath, ...statuses, expiryCutoff) as unknown[]
  ).filter(isMemoryRow)
  return rows.map(toMemory)
}

export function updateMemorySeenCount(
  db: Database,
  id: number,
): void {
  const now = Date.now()
  db.prepare(
    "UPDATE memories SET seen_count = seen_count + 1, last_seen_at = ?, updated_at = ? WHERE id = ?",
  ).run(now, now, id)
}

export function updateMemoryRetrievalCount(
  db: Database,
  id: number,
): void {
  const now = Date.now()
  db.prepare(
    "UPDATE memories SET retrieval_count = retrieval_count + 1, last_retrieved_at = ?, updated_at = ? WHERE id = ?",
  ).run(now, now, id)
}

export function updateMemoryStatus(
  db: Database,
  id: number,
  status: MemoryStatus,
): void {
  db.prepare(
    "UPDATE memories SET status = ?, updated_at = ? WHERE id = ?",
  ).run(status, Date.now(), id)
}

export function updateMemoryContent(
  db: Database,
  id: number,
  content: string,
  normalizedHash: string,
): void {
  db.transaction(() => {
    db.prepare(
      "UPDATE memories SET content = ?, normalized_hash = ?, updated_at = ? WHERE id = ?",
    ).run(content, normalizedHash, Date.now(), id)
    db.prepare("DELETE FROM memory_embeddings WHERE memory_id = ?").run(
      id,
    )
  })()
}

export function archiveMemory(
  db: Database,
  id: number,
  reason?: string,
): void {
  if (!reason?.trim()) {
    updateMemoryStatus(db, id, "archived")
    return
  }
  const memory = getMemoryById(db, id)
  if (!memory) return
  const mergedJson = mergeMetadataJson(memory.metadataJson, {
    archive_reason: reason.trim(),
  })
  db.prepare(
    "UPDATE memories SET status = 'archived', metadata_json = ?, updated_at = ? WHERE id = ?",
  ).run(mergedJson, Date.now(), id)
}

export function deleteMemory(db: Database, id: number): void {
  db.transaction(() => {
    db.prepare("DELETE FROM memory_embeddings WHERE memory_id = ?").run(id)
    db.prepare("DELETE FROM memories WHERE id = ?").run(id)
  })()
}

export function getMemoryCount(
  db: Database,
  projectPath?: string,
): number {
  const sql = projectPath
    ? "SELECT COUNT(*) AS count FROM memories WHERE project_path = ?"
    : "SELECT COUNT(*) AS count FROM memories"
  const row = projectPath
    ? (db.prepare(sql).get(projectPath) as { count: number } | undefined)
    : (db.prepare(sql).get() as { count: number } | undefined)
  return row?.count ?? 0
}

// ── Memory embeddings CRUD ────────────────────────────────────

export function saveMemoryEmbedding(
  db: Database,
  memoryId: number,
  embedding: Float32Array,
  modelId: string,
): void {
  const blob = Buffer.from(
    embedding.buffer,
    embedding.byteOffset,
    embedding.byteLength,
  )
  db.prepare(
    "INSERT INTO memory_embeddings (memory_id, embedding, model_id) VALUES (?, ?, ?) ON CONFLICT(memory_id, model_id) DO UPDATE SET embedding = excluded.embedding",
  ).run(memoryId, blob, modelId)
}

export function loadMemoryEmbeddings(
  db: Database,
  projectPath: string,
  modelId: string,
): Map<number, StoredMemoryEmbedding> {
  const rows = db
    .prepare(
      `SELECT me.memory_id, me.embedding, me.model_id
       FROM memory_embeddings me
       INNER JOIN memories m ON m.id = me.memory_id
       WHERE m.project_path = ? AND me.model_id = ?
       ORDER BY me.memory_id ASC`,
    )
    .all(
      projectPath,
      modelId,
    ) as Array<{ memory_id: number; embedding: Uint8Array; model_id: string | null }>

  const result = new Map<number, StoredMemoryEmbedding>()
  for (const row of rows) {
    const buffer = row.embedding.buffer.slice(
      row.embedding.byteOffset,
      row.embedding.byteOffset + row.embedding.byteLength,
    )
    result.set(row.memory_id, {
      embedding: new Float32Array(buffer),
      modelId: row.model_id,
    })
  }
  return result
}

export function deleteMemoryEmbedding(
  db: Database,
  memoryId: number,
): void {
  db.prepare("DELETE FROM memory_embeddings WHERE memory_id = ?").run(
    memoryId,
  )
}

// ── Memory verifications CRUD ─────────────────────────────────

export function recordMemoryMapping(
  db: Database,
  memoryId: number,
  normalizedFiles: readonly string[],
  now: number,
): number {
  const realFiles = uniqueSortedFiles(normalizedFiles)
  const filesToWrite =
    realFiles.length > 0 ? realFiles : [MEMORY_VERIFICATION_SENTINEL]
  db.prepare("DELETE FROM memory_verifications WHERE memory_id = ?").run(
    memoryId,
  )
  const insert = db.prepare(
    "INSERT INTO memory_verifications (memory_id, file_path, verified_at, mapped_at) VALUES (?, ?, 0, ?)",
  )
  for (const file of filesToWrite) {
    insert.run(memoryId, file, now)
  }
  return filesToWrite.length
}

export function recordMemoryVerifications(
  db: Database,
  memoryId: number,
  normalizedFiles: readonly string[],
  now: number,
): number {
  const realFiles = uniqueSortedFiles(normalizedFiles)
  const filesToWrite =
    realFiles.length > 0 ? realFiles : [MEMORY_VERIFICATION_SENTINEL]
  db.prepare("DELETE FROM memory_verifications WHERE memory_id = ?").run(
    memoryId,
  )
  const insert = db.prepare(
    "INSERT INTO memory_verifications (memory_id, file_path, verified_at, mapped_at) VALUES (?, ?, ?, ?)",
  )
  for (const file of filesToWrite) {
    insert.run(memoryId, file, now, now)
  }
  return filesToWrite.length
}

export function getMemoryVerifications(
  db: Database,
  memoryIds: readonly number[],
): Map<number, MemoryVerificationState> {
  const ids = [...new Set(memoryIds.filter(Number.isInteger))]
  const result = new Map<number, MemoryVerificationState>()
  if (ids.length === 0) return result

  const ph = ids.map(() => "?").join(", ")
  const rows = db
    .prepare(
      `SELECT memory_id, file_path, verified_at, mapped_at
       FROM memory_verifications
       WHERE memory_id IN (${ph})
       ORDER BY memory_id, file_path`,
    )
    .all(...ids) as Array<{
    memory_id: number
    file_path: string
    verified_at: number
    mapped_at: number
  }>

  for (const row of rows) {
    const existing = result.get(row.memory_id) ?? {
      files: [],
      hasSentinel: false,
      verifiedAt: 0,
      mappedAt: 0,
    }
    if (row.file_path === MEMORY_VERIFICATION_SENTINEL) {
      existing.hasSentinel = true
    } else if (!existing.files.includes(row.file_path)) {
      existing.files.push(row.file_path)
    }
    existing.verifiedAt = Math.max(existing.verifiedAt, row.verified_at)
    existing.mappedAt = Math.max(existing.mappedAt, row.mapped_at ?? 0)
    result.set(row.memory_id, existing)
  }

  for (const state of result.values()) {
    state.files.sort()
  }
  return result
}

export function clearMemoryVerifications(
  db: Database,
  memoryId: number,
): void {
  db.prepare("DELETE FROM memory_verifications WHERE memory_id = ?").run(
    memoryId,
  )
}

// ── Helpers ───────────────────────────────────────────────────

export const MEMORY_VERIFICATION_SENTINEL = ""

const MEMORY_CATEGORIES: Record<string, true> = {
  PROJECT_RULES: true,
  ARCHITECTURE: true,
  CONFIG_VALUES: true,
  ARCHITECTURE_DECISIONS: true,
  CONSTRAINTS: true,
  CONFIG_DEFAULTS: true,
  NAMING: true,
  USER_PREFERENCES: true,
  USER_DIRECTIVES: true,
  ENVIRONMENT: true,
  WORKFLOW_RULES: true,
  KNOWN_ISSUES: true,
}

const MEMORY_STATUSES: Record<string, true> = {
  active: true,
  permanent: true,
  archived: true,
}

const MEMORY_SCOPES: Record<string, true> = {
  project: true,
  ecosystem: true,
  universe: true,
}

const MEMORY_SOURCE_TYPES: Record<string, true> = {
  historian: true,
  agent: true,
  dreamer: true,
  user: true,
}

const VERIFICATION_STATUSES: Record<string, true> = {
  unverified: true,
  verified: true,
  stale: true,
  flagged: true,
}

function computeNormalizedHash(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  )
}

function mergeMetadataJson(
  existing: string | null,
  patch: Record<string, string>,
): string | null {
  let base: Record<string, unknown> = {}
  if (existing) {
    try {
      const parsed = JSON.parse(existing)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>
      }
    } catch {
      base = {}
    }
  }
  return JSON.stringify({ ...base, ...patch })
}

function uniqueSortedFiles(files: readonly string[]): string[] {
  return [
    ...new Set(
      files.filter((f) => f !== MEMORY_VERIFICATION_SENTINEL),
    ),
  ].sort()
}

interface MemoryRawRow {
  id: number
  project_path: string
  category: string
  content: string
  normalized_hash: string
  importance: number | null
  scope: string
  shareable: number | null
  source_session_id: string | null
  source_type: string
  seen_count: number
  retrieval_count: number
  first_seen_at: number
  created_at: number
  updated_at: number
  last_seen_at: number
  last_retrieved_at: number | null
  status: string
  expires_at: number | null
  verification_status: string
  verified_at: number | null
  superseded_by_memory_id: number | null
  merged_from: string | null
  metadata_json: string | null
}

function isMemoryRow(row: unknown): row is MemoryRawRow {
  if (row === null || typeof row !== "object") return false
  const c = row as Record<string, unknown>
  return (
    typeof c.id === "number" &&
    typeof c.project_path === "string" &&
    typeof c.content === "string" &&
    typeof c.normalized_hash === "string"
  )
}

function toMemory(row: MemoryRawRow): Memory {
  return {
    id: row.id,
    projectPath: row.project_path,
    category: row.category as MemoryCategory,
    content: row.content,
    normalizedHash: row.normalized_hash,
    importance: row.importance ?? 50,
    scope: (row.scope as MemoryScope) ?? "project",
    shareable: row.shareable ?? 0,
    sourceSessionId: row.source_session_id,
    sourceType: (row.source_type as MemorySourceType) ?? "historian",
    seenCount: row.seen_count,
    retrievalCount: row.retrieval_count,
    firstSeenAt: row.first_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    lastRetrievedAt: row.last_retrieved_at,
    status: (row.status as MemoryStatus) ?? "active",
    expiresAt: row.expires_at,
    verificationStatus:
      (row.verification_status as VerificationStatus) ?? "unverified",
    verifiedAt: row.verified_at,
    supersededByMemoryId: row.superseded_by_memory_id,
    mergedFrom: row.merged_from,
    metadataJson: row.metadata_json,
  }
}
