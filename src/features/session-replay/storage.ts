import { Database } from "bun:sqlite"
import { join, dirname } from "path"
import { tmpdir } from "os"
import { mkdirSync } from "fs"
import { SessionSnapshot, DecisionNode } from "./types"

const DB_PATH = process.env.REPLAY_DB_PATH ?? join(tmpdir(), "oh-my-opencode", "session-replay.db")

let db: Database | null = null

export function getReplayDb(): Database {
  if (db) return db

  const dbDir = dirname(DB_PATH)
  try {
    mkdirSync(dbDir, { recursive: true })
  } catch {
    // Directory may already exist
  }

  db = new Database(DB_PATH)
  db.run("PRAGMA journal_mode = WAL")

  db.run(`
    CREATE TABLE IF NOT EXISTS session_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      tool_name TEXT,
      input_json TEXT,
      output_json TEXT,
      decision TEXT,
      reasoning TEXT,
      duration_ms INTEGER,
      state_diff_json TEXT,
      error TEXT,
      timestamp INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS decision_nodes (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      decision TEXT NOT NULL,
      reasoning TEXT,
      parent_id TEXT,
      duration_ms INTEGER,
      outcome TEXT NOT NULL DEFAULT 'pending'
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_session ON session_snapshots(session_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_seq ON session_snapshots(session_id, sequence)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_decisions_snapshot ON decision_nodes(snapshot_id)`)

  return db
}

export function closeReplayDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function insertSnapshot(snapshot: SessionSnapshot): void {
  const d = getReplayDb()
  d.run(
    `INSERT INTO session_snapshots (id, session_id, sequence, agent_name, event_type, tool_name, input_json, output_json, decision, reasoning, duration_ms, state_diff_json, error, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.id,
      snapshot.sessionId,
      snapshot.sequence,
      snapshot.agentName,
      snapshot.eventType,
      snapshot.toolName ?? null,
      snapshot.input ? JSON.stringify(snapshot.input) : null,
      snapshot.output ? JSON.stringify(snapshot.output) : null,
      snapshot.decision ?? null,
      snapshot.reasoning ?? null,
      snapshot.durationMs ?? null,
      snapshot.stateDiff ? JSON.stringify(snapshot.stateDiff) : null,
      snapshot.error ?? null,
      snapshot.timestamp.getTime(),
    ],
  )
}

export function insertDecisionNode(node: DecisionNode): void {
  const d = getReplayDb()
  d.run(
    `INSERT INTO decision_nodes (id, snapshot_id, agent_name, decision, reasoning, parent_id, duration_ms, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [node.id, node.snapshotId, node.agentName, node.decision, node.reasoning ?? null, node.parentId ?? null, node.durationMs ?? null, node.outcome ?? 'pending'],
  )
}

export function getSnapshots(sessionId: string): SessionSnapshot[] {
  const d = getReplayDb()
  const rows = d.query(
    `SELECT * FROM session_snapshots WHERE session_id = ? ORDER BY sequence ASC`,
  ).all(sessionId) as Array<{
    id: string; session_id: string; sequence: number; agent_name: string; event_type: string
    tool_name: string | null; input_json: string | null; output_json: string | null
    decision: string | null; reasoning: string | null; duration_ms: number | null
    state_diff_json: string | null; error: string | null; timestamp: number
  }>

  return rows.map(r => ({
    id: r.id,
    sessionId: r.session_id,
    sequence: r.sequence,
    agentName: r.agent_name,
    eventType: r.event_type as SessionSnapshot["eventType"],
    toolName: r.tool_name ?? undefined,
    input: r.input_json ? JSON.parse(r.input_json) : undefined,
    output: r.output_json ? JSON.parse(r.output_json) : undefined,
    decision: r.decision ?? undefined,
    reasoning: r.reasoning ?? undefined,
    durationMs: r.duration_ms ?? undefined,
    stateDiff: r.state_diff_json ? JSON.parse(r.state_diff_json) : undefined,
    error: r.error ?? undefined,
    timestamp: new Date(r.timestamp),
  }))
}

export function getDecisionTree(sessionId: string): DecisionNode[] {
  const d = getReplayDb()
  const rows = d.query(
    `SELECT dn.* FROM decision_nodes dn
     INNER JOIN session_snapshots ss ON ss.id = dn.snapshot_id
     WHERE ss.session_id = ?
     ORDER BY ss.sequence ASC`,
  ).all(sessionId) as Array<{
    id: string; snapshot_id: string; agent_name: string; decision: string
    reasoning: string | null; parent_id: string | null; duration_ms: number | null; outcome: string
  }>

  return rows.map(r => ({
    id: r.id,
    snapshotId: r.snapshot_id,
    agentName: r.agent_name,
    decision: r.decision,
    reasoning: r.reasoning ?? undefined,
    parentId: r.parent_id ?? undefined,
    durationMs: r.duration_ms ?? undefined,
    outcome: r.outcome as DecisionNode["outcome"],
    children: [],
  }))
}

export function buildDecisionTree(sessionId: string): DecisionNode | null {
  const nodes = getDecisionTree(sessionId)
  if (nodes.length === 0) return null

  // Find root (no parent)
  const root = nodes.find(n => !n.parentId)
  if (!root) return null

  // Build tree
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const node of nodes) {
    if (node.parentId) {
      const parent = nodeMap.get(node.parentId)
      if (parent) parent.children.push(node)
    }
  }

  return root
}

export function listSessions(): Array<{ sessionId: string; snapshotCount: number }> {
  const d = getReplayDb()
  const rows = d.query(
    `SELECT session_id, COUNT(*) as cnt FROM session_snapshots GROUP BY session_id ORDER BY MAX(timestamp) DESC LIMIT 50`,
  ).all() as Array<{ session_id: string; cnt: number }>
  return rows.map(r => ({ sessionId: r.session_id, snapshotCount: r.cnt }))
}

export function getReplaySummary(sessionId: string): {
  totalSnapshots: number; totalToolCalls: number; totalErrors: number; agents: string[]; tools: string[]
} {
  const d = getReplayDb()
  const count = d.query("SELECT COUNT(*) as c FROM session_snapshots WHERE session_id = ?").get(sessionId) as { c: number }
  const toolCalls = d.query("SELECT COUNT(*) as c FROM session_snapshots WHERE session_id = ? AND event_type = 'tool_call'").get(sessionId) as { c: number }
  const errors = d.query("SELECT COUNT(*) as c FROM session_snapshots WHERE session_id = ? AND event_type = 'error'").get(sessionId) as { c: number }
  const agents = d.query("SELECT DISTINCT agent_name FROM session_snapshots WHERE session_id = ?").all(sessionId) as Array<{ agent_name: string }>
  const tools = d.query("SELECT DISTINCT tool_name FROM session_snapshots WHERE session_id = ? AND tool_name IS NOT NULL").all(sessionId) as Array<{ tool_name: string }>

  return {
    totalSnapshots: count?.c ?? 0,
    totalToolCalls: toolCalls?.c ?? 0,
    totalErrors: errors?.c ?? 0,
    agents: agents.map(a => a.agent_name),
    tools: tools.map(t => t.tool_name).filter(Boolean),
  }
}

export function clearReplayData(): void {
  const d = getReplayDb()
  d.run("DELETE FROM session_snapshots")
  d.run("DELETE FROM decision_nodes")
}
