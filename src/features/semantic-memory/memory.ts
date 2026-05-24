import { getMemoryDb } from "./storage"
import { generateEmbedding } from "./embeddings"
import type { MemoryEntry, MemoryQuery, MemorySearchResult } from "./types"
import { cosineSimilarity } from "./types"

export async function storeMemory(
  content: string,
  options: {
    agentName?: string
    sessionId?: string
    memoryType?: MemoryEntry["memoryType"]
    importance?: number
    id?: string
  } = {},
): Promise<MemoryEntry> {
  const db = await getMemoryDb()
  const embedding = generateEmbedding(content)
  const id = options.id ?? crypto.randomUUID()
  const now = Date.now()

  db.run(
    `INSERT INTO memories (id, content, embedding, agent_name, session_id, memory_type, importance, created_at, access_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      content,
      JSON.stringify(embedding),
      options.agentName ?? null,
      options.sessionId ?? null,
      options.memoryType ?? "context",
      options.importance ?? 1.0,
      now,
      0,
    ],
  )

  return {
    id,
    content,
    embedding,
    agentName: options.agentName,
    sessionId: options.sessionId,
    memoryType: options.memoryType ?? "context",
    importance: options.importance ?? 1.0,
    createdAt: new Date(now),
    accessCount: 0,
  }
}

export async function retrieveMemories(query: MemoryQuery): Promise<MemorySearchResult[]> {
  const db = await getMemoryDb()
  const queryEmbedding = generateEmbedding(query.query)

  let sql = `SELECT * FROM memories WHERE 1=1`
  const params: (string | number)[] = []

  if (query.agentName) {
    sql += ` AND agent_name = ?`
    params.push(query.agentName)
  }

  if (query.memoryType) {
    sql += ` AND memory_type = ?`
    params.push(query.memoryType)
  }

  if (query.sessionId) {
    sql += ` AND session_id = ?`
    params.push(query.sessionId)
  }

  if (query.minImportance !== undefined) {
    sql += ` AND importance >= ?`
    params.push(query.minImportance)
  }

  const stmt = db.query(sql)
  const rows = stmt.all(...params) as Array<{
    id: string
    content: string
    embedding: string
    agent_name: string | null
    session_id: string | null
    memory_type: string
    importance: number
    created_at: number
    accessed_at: number | null
    access_count: number
  }>

  const results: MemorySearchResult[] = rows.map(row => {
    const embedding = JSON.parse(row.embedding) as number[]
    const similarity = cosineSimilarity(queryEmbedding, embedding)

    return {
      entry: {
        id: row.id,
        content: row.content,
        embedding,
        agentName: row.agent_name ?? undefined,
        sessionId: row.session_id ?? undefined,
        memoryType: row.memory_type as MemoryEntry["memoryType"],
        importance: row.importance,
        createdAt: new Date(row.created_at),
        accessedAt: row.accessed_at ? new Date(row.accessed_at) : undefined,
        accessCount: row.access_count,
      },
      similarity,
    }
  })

  results.sort((a, b) => b.similarity - a.similarity)

  const topResults = results.slice(0, query.limit ?? 5)
  for (const result of topResults) {
    db.run(
      `UPDATE memories SET access_count = access_count + 1, accessed_at = ? WHERE id = ?`,
      [Date.now(), result.entry.id],
    )
    result.entry.accessCount += 1
    result.entry.accessedAt = new Date()
  }

  return topResults
}

export async function getRecentMemories(
  options: {
    agentName?: string
    memoryType?: MemoryEntry["memoryType"]
    limit?: number
    hours?: number
  } = {},
): Promise<MemoryEntry[]> {
  const db = await getMemoryDb()
  const cutoff = options.hours
    ? Date.now() - options.hours * 60 * 60 * 1000
    : 0

  let sql = `SELECT * FROM memories WHERE created_at >= ?`
  const params: (string | number)[] = [cutoff]

  if (options.agentName) {
    sql += ` AND agent_name = ?`
    params.push(options.agentName)
  }

  if (options.memoryType) {
    sql += ` AND memory_type = ?`
    params.push(options.memoryType)
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`
  params.push(options.limit ?? 10)

  const stmt = db.query(sql)
  const rows = stmt.all(...params) as Array<{
    id: string
    content: string
    embedding: string
    agent_name: string | null
    session_id: string | null
    memory_type: string
    importance: number
    created_at: number
    accessed_at: number | null
    access_count: number
  }>

  return rows.map(row => ({
    id: row.id,
    content: row.content,
    embedding: JSON.parse(row.embedding) as number[],
    agentName: row.agent_name ?? undefined,
    sessionId: row.session_id ?? undefined,
    memoryType: row.memory_type as MemoryEntry["memoryType"],
    importance: row.importance,
    createdAt: new Date(row.created_at),
    accessedAt: row.accessed_at ? new Date(row.accessed_at) : undefined,
    accessCount: row.access_count,
  }))
}

export async function deleteMemory(id: string): Promise<boolean> {
  const db = await getMemoryDb()
  const result = db.run(`DELETE FROM memories WHERE id = ?`, [id])
  return result.changes > 0
}

export async function clearAllMemories(): Promise<void> {
  const db = await getMemoryDb()
  db.run(`DELETE FROM memories`)
}

export async function getMemoryStats(): Promise<{
  totalMemories: number
  byType: Record<string, number>
  byAgent: Record<string, number>
  avgImportance: number
}> {
  const db = await getMemoryDb()

  const totalResult = db.query(`SELECT COUNT(*) as count FROM memories`).get() as { count: number }
  const totalMemories = totalResult.count

  const typeResult = db.query(`SELECT memory_type, COUNT(*) as count FROM memories GROUP BY memory_type`).all() as Array<{
    memory_type: string
    count: number
  }>

  const agentResult = db.query(`SELECT agent_name, COUNT(*) as count FROM memories GROUP BY agent_name`).all() as Array<{
    agent_name: string | null
    count: number
  }>

  const importanceResult = db.query(`SELECT AVG(importance) as avg FROM memories`).get() as { avg: number | null }

  const byType: Record<string, number> = {}
  for (const row of typeResult) {
    byType[row.memory_type] = row.count
  }

  const byAgent: Record<string, number> = {}
  for (const row of agentResult) {
    byAgent[row.agent_name ?? "unknown"] = row.count
  }

  return {
    totalMemories,
    byType,
    byAgent,
    avgImportance: importanceResult.avg ?? 0,
  }
}
