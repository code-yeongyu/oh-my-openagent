/**
 * MaTrix Kanban — Native task observability.
 *
 * Why this exists (Matrix innovation, not in OMO upstream):
 *   - The user MUST be able to follow project evolution and MaTrix behavior
 *   - Every task goes through states: queued -> in-progress -> review -> done | blocked
 *   - Each task tracks: agent, cost, duration, retry count, last error
 *   - Dashboard rendered as HTML for live monitoring
 *
 * Storage:
 *   - JSONL append-only log at .matrix/kanban.jsonl
 *   - One entry per state change
 *   - Replayable to reconstruct task history
 *
 * This is the OBSERVABILITY layer. Task scheduling is OMO's job (boulder-state).
 * MaTrix Kanban just watches and records.
 */

import { existsSync, appendFileSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { appendLog } from "../../shared/matrix-logger"

export type KanbanState =
  | "queued"
  | "in-progress"
  | "review"
  | "blocked"
  | "done"
  | "cancelled"
  | "failed"

export type KanbanPriority = "low" | "medium" | "high" | "critical"

export interface KanbanTask {
  id: string
  title: string
  description?: string
  agent: string
  state: KanbanState
  priority: KanbanPriority
  project?: string
  parentId?: string
  /** Cost in USD (cumulative across retries) */
  costUsd: number
  /** Number of attempts */
  attempts: number
  /** Last error message (if any) */
  lastError?: string
  /** Whether this task needs human approval to proceed */
  needsApproval: boolean
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  /** Free-form tags */
  tags: string[]
}

export interface KanbanEvent {
  timestamp: string
  taskId: string
  fromState: KanbanState | null
  toState: KanbanState
  agent: string
  costUsd: number
  durationMs?: number
  error?: string
  message?: string
}

function getKanbanDir(): string {
  return join(process.cwd(), ".matrix")
}

function getKanbanFile(): string {
  return join(getKanbanDir(), "kanban.jsonl")
}

function ensureFile(): void {
  if (!existsSync(getKanbanDir())) mkdirSync(getKanbanDir(), { recursive: true })
  if (!existsSync(getKanbanFile())) writeFileSync(getKanbanFile(), "", "utf8")
}

function nextId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create a new task in queued state.
 */
export function createTask(input: Partial<Pick<KanbanTask, "priority" | "tags" | "id">> & {
  title: string
  agent: string
  description?: string
  project?: string
  parentId?: string
  lastError?: string
  needsApproval?: boolean
}): KanbanTask {
  ensureFile()
  const now = new Date().toISOString()
  const task: KanbanTask = {
    id: input.id ?? nextId(),
    title: input.title,
    description: input.description,
    agent: input.agent,
    state: "queued",
    priority: input.priority ?? "medium",
    project: input.project,
    parentId: input.parentId,
    costUsd: 0,
    attempts: 0,
    lastError: input.lastError,
    needsApproval: input.needsApproval ?? false,
    createdAt: now,
    updatedAt: now,
    tags: input.tags ?? [],
  }
    appendFileSync(getKanbanFile(), JSON.stringify(task) + "\n", "utf8")
  appendLog("kanban", task as unknown as Record<string, unknown>)
  return task
}

/**
 * Move a task to a new state. Records the event in the log.
 */
export function transitionTask(
  taskId: string,
  toState: KanbanState,
  options: { error?: string; message?: string; costDelta?: number } = {},
): KanbanTask | null {
  ensureFile()
  const tasks = readTasks()
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return null
  const fromState = task.state
  const now = new Date().toISOString()
  const previous = tasks.find((t) => t.id === taskId)
  if (!previous) return null
  const updated: KanbanTask = {
    ...previous,
    state: toState,
    updatedAt: now,
    costUsd: previous.costUsd + (options.costDelta ?? 0),
    attempts: toState === "in-progress" && fromState !== "in-progress" ? previous.attempts + 1 : previous.attempts,
    lastError: options.error ?? previous.lastError,
    startedAt: toState === "in-progress" && !previous.startedAt ? now : previous.startedAt,
    completedAt: toState === "done" || toState === "cancelled" || toState === "failed" ? now : previous.completedAt,
  }
  appendFileSync(getKanbanFile(), JSON.stringify(updated) + "\n", "utf8")
  appendLog("kanban-transition", updated as unknown as Record<string, unknown>)
  return updated
}

/**
 * Read the current state of all tasks (last entry per task id).
 */
export function readTasks(): KanbanTask[] {
  if (!existsSync(getKanbanFile())) return []
  const content = readFileSync(getKanbanFile(), "utf8")
  const byId = new Map<string, KanbanTask>()
  for (const line of content.split("\n")) {
    if (line.trim().length === 0) continue
    try {
      const t = JSON.parse(line) as KanbanTask
      byId.set(t.id, t)
    } catch {
      // skip
    }
  }
  return Array.from(byId.values())
}

/**
 * Read a single task by id.
 */
export function getTask(taskId: string): KanbanTask | null {
  return readTasks().find((t) => t.id === taskId) ?? null
}

/**
 * Compute Kanban statistics.
 */
export interface KanbanStats {
  totalTasks: number
  byState: Record<KanbanState, number>
  byAgent: Record<string, { count: number; costUsd: number }>
  byPriority: Record<KanbanPriority, number>
  totalCost: number
  avgCompletionTimeMs: number | null
  blockedTasks: KanbanTask[]
}

export function computeStats(): KanbanStats {
  const tasks = readTasks()
  const byState: Record<KanbanState, number> = {
    queued: 0, "in-progress": 0, review: 0, blocked: 0, done: 0, cancelled: 0, failed: 0,
  }
  const byAgent: Record<string, { count: number; costUsd: number }> = {}
  const byPriority: Record<KanbanPriority, number> = { low: 0, medium: 0, high: 0, critical: 0 }
  let totalCost = 0
  const completionTimes: number[] = []
  for (const t of tasks) {
    byState[t.state]++
    byPriority[t.priority]++
    if (!byAgent[t.agent]) byAgent[t.agent] = { count: 0, costUsd: 0 }
    byAgent[t.agent].count++
    byAgent[t.agent].costUsd += t.costUsd
    totalCost += t.costUsd
    if (t.startedAt && t.completedAt) {
      completionTimes.push(new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime())
    }
  }
  const avgCompletionTimeMs = completionTimes.length > 0
    ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
    : null
  const blockedTasks = tasks.filter((t) => t.state === "blocked")
  return {
    totalTasks: tasks.length,
    byState,
    byAgent,
    byPriority,
    totalCost,
    avgCompletionTimeMs,
    blockedTasks,
  }
}

/**
 * Generate HTML dashboard for the Kanban.
 */
export function generateKanbanDashboard(): string {
  const tasks = readTasks()
  const stats = computeStats()
  const sortedTasks = [...tasks].sort((a, b) => {
    const order: Record<KanbanPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    return order[a.priority] - order[b.priority] || a.createdAt.localeCompare(b.createdAt)
  })
  const recentTasks = sortedTasks.slice(0, 50)
  const stateColor: Record<KanbanState, string> = {
    queued: "#6b7280",
    "in-progress": "#3b82f6",
    review: "#a855f7",
    blocked: "#ef4444",
    done: "#10b981",
    cancelled: "#6b7280",
    failed: "#ef4444",
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MaTrix Kanban</title>
  <meta http-equiv="refresh" content="5">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
    h1 { color: #00d9ff; margin-bottom: 8px; }
    .subtitle { color: #666; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; }
    .card h3 { color: #888; font-size: 11px; text-transform: uppercase; margin-bottom: 8px; }
    .card .value { font-size: 28px; font-weight: bold; color: #00d9ff; }
    .states { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-bottom: 32px; }
    .state-col { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 12px; }
    .state-col h4 { font-size: 11px; text-transform: uppercase; margin-bottom: 12px; }
    .state-col .count { font-size: 24px; font-weight: bold; }
    .task { background: #0f0f0f; border: 1px solid #2a2a2a; border-radius: 6px; padding: 12px; margin-bottom: 8px; }
    .task .title { font-weight: bold; margin-bottom: 4px; }
    .task .meta { font-size: 11px; color: #888; }
    .task.priority-critical { border-left: 3px solid #ef4444; }
    .task.priority-high { border-left: 3px solid #f59e0b; }
    .task.priority-medium { border-left: 3px solid #3b82f6; }
    .task.priority-low { border-left: 3px solid #6b7280; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-right: 4px; }
    .badge.state-queued { background: #6b728033; color: #9ca3af; }
    .badge.state-in-progress { background: #3b82f633; color: #60a5fa; }
    .badge.state-review { background: #a855f733; color: #c084fc; }
    .badge.state-blocked { background: #ef444433; color: #f87171; }
    .badge.state-done { background: #10b98133; color: #34d399; }
    .badge.state-failed { background: #ef444433; color: #f87171; }
    .badge.state-cancelled { background: #6b728033; color: #9ca3af; }
  </style>
</head>
<body>
  <h1>MaTrix Kanban</h1>
  <p class="subtitle">Live task observability — ${stats.totalTasks} tasks, $${stats.totalCost.toFixed(4)} total cost</p>

  <div class="grid">
    <div class="card">
      <h3>Total Tasks</h3>
      <div class="value">${stats.totalTasks}</div>
    </div>
    <div class="card">
      <h3>Total Cost</h3>
      <div class="value">$${stats.totalCost.toFixed(4)}</div>
    </div>
    <div class="card">
      <h3>Blocked</h3>
      <div class="value" style="color: ${stats.blockedTasks.length > 0 ? '#ef4444' : '#10b981'};">${stats.blockedTasks.length}</div>
    </div>
    <div class="card">
      <h3>Avg Completion</h3>
      <div class="value">${stats.avgCompletionTimeMs ? (stats.avgCompletionTimeMs / 1000).toFixed(1) + 's' : '—'}</div>
    </div>
  </div>

  <h2 style="margin-bottom: 16px;">By State</h2>
  <div class="states">
    ${(Object.entries(stats.byState) as [KanbanState, number][]).map(([state, count]) => `
      <div class="state-col">
        <h4 style="color: ${stateColor[state]};">${state}</h4>
        <div class="count" style="color: ${stateColor[state]};">${count}</div>
      </div>
    `).join("")}
  </div>

  <h2 style="margin-bottom: 16px;">Recent Tasks</h2>
  ${recentTasks.map((t) => `
    <div class="task priority-${t.priority}">
      <div class="title">${t.title}</div>
      <div class="meta">
        <span class="badge state-${t.state}">${t.state}</span>
        <span class="badge state-queued" style="background: #00d9ff33; color: #00d9ff;">${t.priority}</span>
        agent: <strong>${t.agent}</strong>
        ${t.project ? ` · project: <strong>${t.project}</strong>` : ""}
        ${t.attempts > 0 ? ` · attempts: ${t.attempts}` : ""}
        ${t.costUsd > 0 ? ` · $${t.costUsd.toFixed(4)}` : ""}
        ${t.lastError ? ` · <span style="color:#ef4444;">err: ${t.lastError.slice(0, 80)}</span>` : ""}
      </div>
    </div>
  `).join("")}
</body>
</html>`
}

/**
 * Save the Kanban dashboard to disk.
 */
export function saveKanbanDashboard(): string {
  const html = generateKanbanDashboard()
  const path = join(getKanbanDir(), "kanban.html")
  writeFileSync(path, html, "utf8")
  return path
}
