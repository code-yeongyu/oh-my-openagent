import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { log } from "../../shared"

const STATE_FILE_PATH = join(homedir(), ".claude-mem", "opencode-sessions.json")
const IDLE_CONFIRMATION_DELAY_MS = 60_000

const pendingStopHooks = new Map<string, ReturnType<typeof setTimeout>>()
const sessionActivitySinceIdle = new Set<string>()

export type SessionStatus = "active" | "idle" | "completed"

export interface SessionState {
  sessionId: string
  project: string
  cwd: string
  lastActivity: number
  lastActivityType: string
  status: SessionStatus
  summaryGeneratedAt: number | null
  createdAt: number
}

export interface SessionStateFile {
  sessions: Record<string, SessionState>
  version: number
}

function ensureStateDir(): void {
  const dir = dirname(STATE_FILE_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readStateFile(): SessionStateFile {
  try {
    if (existsSync(STATE_FILE_PATH)) {
      const content = readFileSync(STATE_FILE_PATH, "utf-8")
      return JSON.parse(content) as SessionStateFile
    }
  } catch (e) {
    log("Failed to read session state file", { error: String(e) })
  }
  return { sessions: {}, version: 1 }
}

function writeStateFile(state: SessionStateFile): void {
  try {
    ensureStateDir()
    writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2))
  } catch (e) {
    log("Failed to write session state file", { error: String(e) })
  }
}

export function getSessionState(sessionId: string): SessionState | null {
  const state = readStateFile()
  return state.sessions[sessionId] || null
}

export function updateSessionActivity(
  sessionId: string,
  activityType: string,
  options: { project?: string; cwd?: string } = {}
): void {
  const state = readStateFile()
  const now = Date.now()

  const existing = state.sessions[sessionId]
  
  state.sessions[sessionId] = {
    sessionId,
    project: options.project || existing?.project || "",
    cwd: options.cwd || existing?.cwd || "",
    lastActivity: now,
    lastActivityType: activityType,
    status: "active",
    summaryGeneratedAt: existing?.summaryGeneratedAt || null,
    createdAt: existing?.createdAt || now,
  }

  writeStateFile(state)
}

export function markSessionIdle(sessionId: string): void {
  const state = readStateFile()
  const existing = state.sessions[sessionId]
  
  if (existing) {
    existing.status = "idle"
    existing.lastActivity = Date.now()
    existing.lastActivityType = "session.idle"
    writeStateFile(state)
  }
}

export function markSummaryGenerated(sessionId: string): void {
  const state = readStateFile()
  const existing = state.sessions[sessionId]
  
  if (existing) {
    existing.summaryGeneratedAt = Date.now()
    writeStateFile(state)
  }
}

export function markSessionCompleted(sessionId: string): void {
  const state = readStateFile()
  const existing = state.sessions[sessionId]
  
  if (existing) {
    existing.status = "completed"
    existing.lastActivity = Date.now()
    writeStateFile(state)
  }
}

export function scheduleStopHook(
  sessionId: string,
  onConfirmedIdle: () => void
): void {
  if (pendingStopHooks.has(sessionId)) {
    return
  }

  sessionActivitySinceIdle.delete(sessionId)

  const timer = setTimeout(() => {
    pendingStopHooks.delete(sessionId)

    if (sessionActivitySinceIdle.has(sessionId)) {
      sessionActivitySinceIdle.delete(sessionId)
      log("Stop hook cancelled - activity detected during idle confirmation", { sessionId })
      return
    }

    log("Stop hook executing after confirmed idle", { sessionId, delayMs: IDLE_CONFIRMATION_DELAY_MS })
    onConfirmedIdle()
  }, IDLE_CONFIRMATION_DELAY_MS)

  pendingStopHooks.set(sessionId, timer)
  log("Stop hook scheduled", { sessionId, delayMs: IDLE_CONFIRMATION_DELAY_MS })
}

export function cancelPendingStopHook(sessionId: string): void {
  const timer = pendingStopHooks.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    pendingStopHooks.delete(sessionId)
    log("Pending stop hook cancelled", { sessionId })
  }
}

export function markActivitySinceIdle(sessionId: string): void {
  if (pendingStopHooks.has(sessionId)) {
    sessionActivitySinceIdle.add(sessionId)
  }
}

export function hasPendingStopHook(sessionId: string): boolean {
  return pendingStopHooks.has(sessionId)
}

export function getOrphanedSessions(staleThresholdMs: number = 5 * 60 * 1000): SessionState[] {
  const state = readStateFile()
  const now = Date.now()
  const orphaned: SessionState[] = []

  for (const session of Object.values(state.sessions)) {
    const isStale = (now - session.lastActivity) > staleThresholdMs
    const notCompleted = session.status !== "completed"
    const noSummary = !session.summaryGeneratedAt

    if (isStale && notCompleted && noSummary) {
      orphaned.push(session)
    }
  }

  return orphaned
}

export function cleanupOldSessions(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
  const state = readStateFile()
  const now = Date.now()
  let cleaned = 0

  for (const [sessionId, session] of Object.entries(state.sessions)) {
    if ((now - session.lastActivity) > maxAgeMs) {
      delete state.sessions[sessionId]
      cleaned++
    }
  }

  if (cleaned > 0) {
    writeStateFile(state)
  }

  return cleaned
}
