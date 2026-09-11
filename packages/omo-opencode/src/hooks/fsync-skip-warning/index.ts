import { drainSkipsAfter } from "../../shared/fsync-skip-tracker"
import { formatFsyncSkipWarning } from "../../shared/fsync-skip-warning-formatter"

type ToolExecuteInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolBeforeOutput = {
  args: Record<string, unknown>
}

type ToolAfterOutput = {
  title: string
  output: string
  metadata: unknown
}

export const FSYNC_SKIP_START_TTL_MS = 60_000

const startTimesByCallId = new Map<string, number>()
let cleanupInterval: ReturnType<typeof setInterval> | null = null

function pruneStaleStartTimes(now = Date.now()): void {
  for (const [callID, startedAt] of startTimesByCallId) {
    if (now - startedAt > FSYNC_SKIP_START_TTL_MS) {
      startTimesByCallId.delete(callID)
    }
  }
}

function ensureCleanupInterval(): void {
  if (cleanupInterval) return
  cleanupInterval = setInterval(() => pruneStaleStartTimes(), FSYNC_SKIP_START_TTL_MS)
  if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
    cleanupInterval.unref()
  }
}

export function hasFsyncSkipStartTime(callID: string): boolean {
  return startTimesByCallId.has(callID)
}

export function stopFsyncSkipWarningCleanup(): void {
  startTimesByCallId.clear()
  if (!cleanupInterval) return
  clearInterval(cleanupInterval)
  cleanupInterval = null
}

export function createFsyncSkipWarningHook() {
  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    _output: ToolBeforeOutput,
  ): Promise<void> => {
    ensureCleanupInterval()
    startTimesByCallId.set(input.callID, Date.now())
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolAfterOutput,
  ): Promise<void> => {
    const startTimestamp = startTimesByCallId.get(input.callID) ?? 0
    startTimesByCallId.delete(input.callID)
    if (typeof output.output !== "string") return

    const skips = drainSkipsAfter(startTimestamp)
    const warning = formatFsyncSkipWarning(skips)
    if (warning.length === 0) return

    output.output = `${output.output}\n\n${warning}`
  }

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    dispose: stopFsyncSkipWarningCleanup,
  }
}
