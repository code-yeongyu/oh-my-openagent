import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { MonitorCounters, MonitorManager, MonitorOutputArgs, MonitorOutputResult } from "../../features/monitor/types"

type MonitorOutputToolContext = {
  sessionID: string
}

type MonitorOutputNotFoundResult = MonitorOutputResult & {
  error: "not_found"
}

const EMPTY_COUNTERS: MonitorCounters = {
  totalLines: 0,
  matchedLines: 0,
  unmatchedLines: 0,
  droppedMatched: 0,
  droppedUnmatched: 0,
  bytesDropped: 0,
  lastSequence: 0,
}

export function createMonitorOutput(manager: MonitorManager): ToolDefinition {
  return tool({
    description: `Retrieve retained monitor output for the calling session.

Returns both output lines and counters so agents can detect dropped lines. Unknown or unauthorized monitor IDs return a not_found result instead of throwing.`,
    args: {
      monitor_id: tool.schema.string().describe("Monitor ID to read output from"),
      stream: tool.schema
        .enum(["matched", "unmatched", "all"])
        .optional()
        .describe("Which retained stream to return: matched, unmatched, or all. Defaults to all."),
      since_sequence: tool.schema.number().optional().describe("Return only lines with seq greater than this value"),
      limit: tool.schema.number().optional().describe("Maximum number of retained lines to return"),
    },
    async execute(args: MonitorOutputArgs, toolContext): Promise<string> {
      const ctx = toolContext as MonitorOutputToolContext
      const record = manager.get(args.monitor_id)

      if (!record || record.parentSessionId !== ctx.sessionID) {
        return JSON.stringify(createNotFoundResult())
      }

      const output = manager.getOutput(args.monitor_id, {
        stream: args.stream ?? "all",
        ...(args.since_sequence === undefined ? {} : { since_sequence: args.since_sequence }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      })

      return JSON.stringify(output)
    },
  })
}

function createNotFoundResult(): MonitorOutputNotFoundResult {
  return {
    lines: [],
    counters: { ...EMPTY_COUNTERS },
    error: "not_found",
  }
}
