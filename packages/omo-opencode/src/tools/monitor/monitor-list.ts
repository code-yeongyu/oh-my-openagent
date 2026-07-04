import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { MonitorManager, MonitorRecord, MonitorStatus } from "../../features/monitor"

interface MonitorListArgs {
  include_exited?: boolean
}

interface MonitorToolContext {
  sessionID: string
}

interface MonitorListContext {
  sessionID: string
}

const hiddenStatuses = new Set<MonitorStatus>(["exited", "stopped", "failed"])

function formatStartedAt(startedAt: Date): string {
  return startedAt.toISOString()
}

function formatMonitor(record: MonitorRecord) {
  return {
    id: record.id,
    label: record.label,
    mode: record.mode,
    startedAt: formatStartedAt(record.startedAt),
    status: record.status,
    counters: {
      matched: record.counters.matchedLines,
      unmatched: record.counters.unmatchedLines,
      droppedMatched: record.counters.droppedMatched,
      droppedUnmatched: record.counters.droppedUnmatched,
      bytesDropped: record.counters.bytesDropped,
      lastSequence: record.counters.lastSequence,
    },
  }
}

export function createMonitorList(
  manager: MonitorManager,
  ctx: MonitorListContext
): ToolDefinition {
  return tool({
    description: `List monitors owned by the current session.

Returns id, label, mode, startedAt, status, and counters. Raw commands are never included.`,
    args: {
      include_exited: tool.schema
        .boolean()
        .optional()
        .describe("Include exited, stopped, and failed monitors. Defaults to false."),
    },
    execute: async (args: MonitorListArgs, toolContext): Promise<string> => {
      const sessionID = ctx.sessionID || (toolContext as MonitorToolContext).sessionID
      const includeExited = args.include_exited ?? false
      const records = manager.list(sessionID)
      const monitors = records
        .filter((record) => includeExited || !hiddenStatuses.has(record.status))
        .map(formatMonitor)

      return JSON.stringify({ monitors })
    },
  })
}
