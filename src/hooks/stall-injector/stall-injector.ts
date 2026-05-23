import type { BackgroundTask } from "../../features/background-agent"
import {
  DEFAULT_STALL_CRITICAL_AFTER_MS,
  DEFAULT_STALL_WARNING_AFTER_MS,
} from "../../features/background-agent/constants"

interface ChatMessageInput {
  sessionID: string
}

interface ChatMessagePart {
  type: string
  text?: string
  role?: string
  [key: string]: unknown
}

interface ChatMessageOutput {
  parts: ChatMessagePart[]
}

interface StallInjectorConfig {
  stall_warning_after_ms?: number
  stall_critical_after_ms?: number
}

interface StallInjectorDeps {
  getTasksByParentSession: (sessionId: string) => BackgroundTask[]
  getConfig: () => StallInjectorConfig
}

interface StalledTask {
  task: BackgroundTask
  level: "warning" | "critical"
  duration: number
}

const RATE_LIMIT_WINDOW_MS = 30_000
const STALE_CLEANUP_MS = 60_000

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (remainingSeconds === 0) return `${minutes}m`

  return `${minutes}m${remainingSeconds}s`
}

function resolveThresholds(config: StallInjectorConfig): {
  warningAfterMs: number
  criticalAfterMs: number
} {
  const warningAfterMs = config.stall_warning_after_ms ?? DEFAULT_STALL_WARNING_AFTER_MS
  const configuredCriticalAfterMs =
    config.stall_critical_after_ms ?? DEFAULT_STALL_CRITICAL_AFTER_MS

  return {
    warningAfterMs,
    criticalAfterMs: Math.max(configuredCriticalAfterMs, warningAfterMs),
  }
}

function getLastActivityMs(task: BackgroundTask): number | null {
  const lastUpdate = task.progress?.lastUpdate ?? task.startedAt
  if (!lastUpdate) return null

  const lastUpdateMs =
    lastUpdate instanceof Date ? lastUpdate.getTime() : new Date(lastUpdate).getTime()

  return Number.isFinite(lastUpdateMs) ? lastUpdateMs : null
}

function getStallLevel(
  duration: number,
  thresholds: { warningAfterMs: number; criticalAfterMs: number },
): "warning" | "critical" | null {
  if (duration >= thresholds.criticalAfterMs) return "critical"
  if (duration >= thresholds.warningAfterMs) return "warning"
  return null
}

function buildAlert(stalledTasks: StalledTask[]): string {
  if (stalledTasks.length === 1) {
    const { task, duration } = stalledTasks[0]
    const lastTool = task.progress?.lastTool || "starting"

    return `<system-reminder>
[SUBAGENT STALL] ${task.agent} inactive ${formatDuration(duration)} (last: ${lastTool}). Task ID: ${task.id}
Use background_output(task_id="${task.id}") to inspect.
</system-reminder>`
  }

  const lines = stalledTasks.map(({ task, duration }) => {
    const lastTool = task.progress?.lastTool || "starting"
    return `- ${task.agent} - inactive ${formatDuration(duration)} (last: ${lastTool})`
  })

  return `<system-reminder>
[SUBAGENT STALL] ${stalledTasks.length} subagents stalled:
${lines.join("\n")}
Use background_output(task_id="<taskId>") to inspect each.
</system-reminder>`
}

export function createStallInjectorHook(deps: StallInjectorDeps) {
  const { getTasksByParentSession, getConfig } = deps
  const injectedAlerts = new Map<string, { level: string; injectedAt: number }>()

  function cleanupStaleEntries(): void {
    const now = Date.now()

    for (const [key, entry] of injectedAlerts.entries()) {
      if (now - entry.injectedAt > STALE_CLEANUP_MS) {
        injectedAlerts.delete(key)
      }
    }
  }

  const chatMessageHandler = async (
    input: ChatMessageInput,
    output: ChatMessageOutput,
  ): Promise<void> => {
    cleanupStaleEntries()

    const thresholds = resolveThresholds(getConfig())
    const tasks = getTasksByParentSession(input.sessionID)
    const stalledTasks: StalledTask[] = []

    for (const task of tasks) {
      if (task.status !== "running") continue

      // Team-managed tasks use their own idle/blocked/stalled taxonomy;
      // flagging them here would produce false-positive [SUBAGENT STALL] alerts.
      if (task.teamRunId) {
        continue
      }

      const lastActivityMs = getLastActivityMs(task)
      if (lastActivityMs === null) continue

      const now = Date.now()
      const duration = now - lastActivityMs
      const level = getStallLevel(duration, thresholds)
      if (!level) continue

      const previous = injectedAlerts.get(task.id)
      if (previous && previous.level === level && now - previous.injectedAt < RATE_LIMIT_WINDOW_MS) {
        continue
      }

      stalledTasks.push({ task, level, duration })
      injectedAlerts.set(task.id, { level, injectedAt: now })
    }

    if (stalledTasks.length === 0) return

    output.parts.push({
      type: "text",
      text: buildAlert(stalledTasks),
      role: "system",
    })
  }

  return {
    "chat.message": chatMessageHandler,
  }
}
