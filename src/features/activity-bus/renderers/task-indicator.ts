/**
 * Task status indicator renderers - pure string formatting functions
 * for inline display of subagent/background task activity in chat.
 */

function formatDuration(ms: number): string {
  if (ms < 1000) return "0s"
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

export { formatDuration }

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars - 1) + "…"
}

export interface RunningTask {
  agent: string
  description?: string
  toolCalls: number
  duration: number
}

export function renderRunning(task: RunningTask): string {
  const agent = task.agent
  const desc = task.description ? ` ${truncate(task.description, 40)}` : ""
  const time = formatDuration(task.duration)
  const tools = task.toolCalls > 0 ? ` | 🔧 ${task.toolCalls} tools` : ""
  return `⏳ ${agent}${desc} | ⏱ ${time}${tools}`
}

export interface CompletedTask {
  agent: string
  duration: number
}

export function renderCompleted(task: CompletedTask): string {
  return `✅ ${task.agent} completed | ⏱ ${formatDuration(task.duration)}`
}

export interface ErrorTask {
  agent: string
  error: string
  duration: number
}

export function renderError(task: ErrorTask): string {
  const err = truncate(task.error, 50)
  return `❌ ${task.agent} errored | Error: ${err} | ⏱ ${formatDuration(task.duration)}`
}

export interface QueuedTask {
  agent: string
  position?: number
}

export function renderQueued(task: QueuedTask): string {
  const pos = task.position != null ? ` | Position: ${task.position}` : ""
  return `⏸ ${task.agent} waiting${pos}`
}

export function renderStatusSummary(running: number, queued: number): string {
  if (running === 0 && queued === 0) return "📊 No active agents"
  const parts: string[] = []
  if (running > 0) parts.push(`${running} running`)
  if (queued > 0) parts.push(`${queued} queued`)
  return `📊 Agents: ${parts.join(", ")}`
}
