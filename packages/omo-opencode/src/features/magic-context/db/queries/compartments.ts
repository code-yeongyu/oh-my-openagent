/**
 * CRUD for compartments + compartment_chunk_embeddings.
 *
 * Ported from MC's compartment-storage.ts and compartment-chunk-embedding.ts.
 */

import type { Database } from "../sqlite"

// ── Compartment types ─────────────────────────────────────────

export interface Compartment {
  id: number
  sessionId: string
  sequence: number
  startMessage: number
  endMessage: number
  startMessageId: string
  endMessageId: string
  title: string
  content: string
  p1: string | null
  p2: string | null
  p3: string | null
  p4: string | null
  importance: number
  episodeType: string | null
  legacy: number
  createdAt: number
}

export interface CompartmentInput {
  sequence: number
  startMessage: number
  endMessage: number
  startMessageId: string
  endMessageId: string
  title: string
  content: string
  p1?: string | null
  p2?: string | null
  p3?: string | null
  p4?: string | null
  importance?: number | null
  episodeType?: string | null
}

export interface SessionFact {
  id: number
  sessionId: string
  category: string
  content: string
  createdAt: number
  updatedAt: number
}

export interface CompartmentChunkEmbedding {
  id: number
  compartmentId: number
  sessionId: string
  projectPath: string
  windowIndex: number
  startOrdinal: number
  endOrdinal: number
  chunkHash: string
  modelId: string
  dims: number
  vector: Uint8Array
  createdAt: number
}

export interface ChunkEmbeddingInput {
  compartmentId: number
  sessionId: string
  projectPath: string
  windowIndex: number
  startOrdinal: number
  endOrdinal: number
  chunkHash: string
  modelId: string
  dims: number
  vector: Uint8Array
}

// ── Row types ─────────────────────────────────────────────────

interface CompartmentRow {
  id: number
  session_id: string
  sequence: number
  start_message: number
  end_message: number
  start_message_id: string
  end_message_id: string
  title: string
  content: string
  p1: string | null
  p2: string | null
  p3: string | null
  p4: string | null
  importance: number | null
  episode_type: string | null
  legacy: number | null
  created_at: number
}

// ── Guards ────────────────────────────────────────────────────

function isCompartmentRow(row: unknown): row is CompartmentRow {
  if (row === null || typeof row !== "object") return false
  const c = row as Record<string, unknown>
  return (
    typeof c.id === "number" &&
    typeof c.session_id === "string" &&
    typeof c.sequence === "number" &&
    typeof c.start_message === "number" &&
    typeof c.end_message === "number" &&
    typeof c.title === "string" &&
    typeof c.content === "string" &&
    typeof c.created_at === "number"
  )
}

// ── Mappers ───────────────────────────────────────────────────

function toCompartment(row: CompartmentRow): Compartment {
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    startMessage: row.start_message,
    endMessage: row.end_message,
    startMessageId: row.start_message_id,
    endMessageId: row.end_message_id,
    title: row.title,
    content: row.content,
    p1: row.p1 ?? null,
    p2: row.p2 ?? null,
    p3: row.p3 ?? null,
    p4: row.p4 ?? null,
    importance: typeof row.importance === "number" ? row.importance : 50,
    episodeType: row.episode_type ?? null,
    legacy: typeof row.legacy === "number" ? row.legacy : 0,
    createdAt: row.created_at,
  }
}

// ── Compartment CRUD ──────────────────────────────────────────

export function getCompartments(
  db: Database,
  sessionId: string,
): Compartment[] {
  const rows = (
    db
      .prepare(
        "SELECT * FROM compartments WHERE session_id = ? ORDER BY sequence ASC",
      )
      .all(sessionId) as unknown[]
  ).filter(isCompartmentRow)
  return rows.map(toCompartment)
}

export function getCompartmentById(
  db: Database,
  id: number,
): Compartment | null {
  const row = db.prepare("SELECT * FROM compartments WHERE id = ?").get(id)
  return isCompartmentRow(row) ? toCompartment(row) : null
}

export function getLastCompartmentEndMessage(
  db: Database,
  sessionId: string,
): number {
  const row = db
    .prepare(
      "SELECT MAX(end_message) as max_end FROM compartments WHERE session_id = ?",
    )
    .get(sessionId) as { max_end: number | null } | null
  return row?.max_end ?? -1
}

export function getLastCompartmentEndMessageId(
  db: Database,
  sessionId: string,
): string | null {
  const row = db
    .prepare(
      "SELECT end_message_id FROM compartments WHERE session_id = ? ORDER BY sequence DESC LIMIT 1",
    )
    .get(sessionId) as { end_message_id: string | null } | undefined
  const id = row?.end_message_id
  return id && id.length > 0 ? id : null
}

export function insertCompartment(
  db: Database,
  sessionId: string,
  input: CompartmentInput,
): void {
  const hasTiers =
    typeof input.p1 === "string" && input.p1.length > 0
  db.prepare(
    `INSERT INTO compartments
      (session_id, sequence, start_message, end_message,
       start_message_id, end_message_id, title, content,
       p1, p2, p3, p4, importance, episode_type, legacy, created_at, harness)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'opencode')`,
  ).run(
    sessionId,
    input.sequence,
    input.startMessage,
    input.endMessage,
    input.startMessageId,
    input.endMessageId,
    input.title,
    input.content,
    input.p1 ?? null,
    input.p2 ?? null,
    input.p3 ?? null,
    input.p4 ?? null,
    typeof input.importance === "number" ? input.importance : 50,
    input.episodeType ?? null,
    hasTiers ? 0 : 1,
    Date.now(),
  )
}

export function replaceAllCompartments(
  db: Database,
  sessionId: string,
  compartments: CompartmentInput[],
): void {
  const now = Date.now()
  db.transaction(() => {
    db.prepare("DELETE FROM compartments WHERE session_id = ?").run(
      sessionId,
    )
    for (const c of compartments) {
      const hasTiers =
        typeof c.p1 === "string" && c.p1.length > 0
      db.prepare(
        `INSERT INTO compartments
          (session_id, sequence, start_message, end_message,
           start_message_id, end_message_id, title, content,
           p1, p2, p3, p4, importance, episode_type, legacy, created_at, harness)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'opencode')`,
      ).run(
        sessionId,
        c.sequence,
        c.startMessage,
        c.endMessage,
        c.startMessageId,
        c.endMessageId,
        c.title,
        c.content,
        c.p1 ?? null,
        c.p2 ?? null,
        c.p3 ?? null,
        c.p4 ?? null,
        typeof c.importance === "number" ? c.importance : 50,
        c.episodeType ?? null,
        hasTiers ? 0 : 1,
        now,
      )
    }
  })()
}

export function deleteCompartmentsBySession(
  db: Database,
  sessionId: string,
): void {
  db.prepare("DELETE FROM compartments WHERE session_id = ?").run(
    sessionId,
  )
}

// ── Compartment chunk embeddings CRUD ────────────────────────

export function insertChunkEmbedding(
  db: Database,
  input: ChunkEmbeddingInput,
): void {
  db.prepare(
    `INSERT INTO compartment_chunk_embeddings
      (compartment_id, session_id, project_path, harness,
       window_index, start_ordinal, end_ordinal,
       chunk_hash, model_id, dims, vector, created_at)
     VALUES (?, ?, ?, 'opencode', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.compartmentId,
    input.sessionId,
    input.projectPath,
    input.windowIndex,
    input.startOrdinal,
    input.endOrdinal,
    input.chunkHash,
    input.modelId,
    input.dims,
    input.vector,
    Date.now(),
  )
}

interface ChunkEmbeddingRawRow {
  id: number
  compartment_id: number
  session_id: string
  project_path: string
  window_index: number
  start_ordinal: number
  end_ordinal: number
  chunk_hash: string
  model_id: string
  dims: number
  vector: Uint8Array
  created_at: number
}

function toChunkEmbedding(row: ChunkEmbeddingRawRow): CompartmentChunkEmbedding {
  return {
    id: row.id,
    compartmentId: row.compartment_id,
    sessionId: row.session_id,
    projectPath: row.project_path,
    windowIndex: row.window_index,
    startOrdinal: row.start_ordinal,
    endOrdinal: row.end_ordinal,
    chunkHash: row.chunk_hash,
    modelId: row.model_id,
    dims: row.dims,
    vector: row.vector,
    createdAt: row.created_at,
  }
}

export function getChunkEmbeddingsBySession(
  db: Database,
  sessionId: string,
): CompartmentChunkEmbedding[] {
  const rows = db
    .prepare(
      "SELECT * FROM compartment_chunk_embeddings WHERE session_id = ? ORDER BY id",
    )
    .all(sessionId) as ChunkEmbeddingRawRow[]
  return rows.map(toChunkEmbedding)
}

export function deleteChunkEmbeddingsBySession(
  db: Database,
  sessionId: string,
): void {
  db.prepare(
    "DELETE FROM compartment_chunk_embeddings WHERE session_id = ?",
  ).run(sessionId)
}

// ── Session facts CRUD ────────────────────────────────────────

interface SessionFactRawRow {
  id: number
  session_id: string
  category: string
  content: string
  created_at: number
  updated_at: number
}

function toSessionFact(row: SessionFactRawRow): SessionFact {
  return {
    id: row.id,
    sessionId: row.session_id,
    category: row.category,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getSessionFacts(
  db: Database,
  sessionId: string,
): SessionFact[] {
  const rows = db
    .prepare(
      "SELECT * FROM session_facts WHERE session_id = ? ORDER BY category ASC, id ASC",
    )
    .all(sessionId) as SessionFactRawRow[]
  return rows.map(toSessionFact)
}

export function replaceSessionFacts(
  db: Database,
  sessionId: string,
  facts: Array<{ category: string; content: string }>,
): void {
  const now = Date.now()
  db.transaction(() => {
    db.prepare("DELETE FROM session_facts WHERE session_id = ?").run(
      sessionId,
    )
    const stmt = db.prepare(
      "INSERT INTO session_facts (session_id, category, content, created_at, updated_at, harness) VALUES (?, ?, ?, ?, ?, 'opencode')",
    )
    for (const f of facts) {
      stmt.run(sessionId, f.category, f.content, now, now)
    }
  })()
}

export function deleteSessionFactsBySession(
  db: Database,
  sessionId: string,
): void {
  db.prepare("DELETE FROM session_facts WHERE session_id = ?").run(
    sessionId,
  )
}
