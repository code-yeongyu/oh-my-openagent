import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { MonitorManager } from "../../features/monitor"

export interface MonitorStopArgs {
  monitor_id: string
}

export type MonitorStopResult =
  | { status: "stopped"; monitor_id: string }
  | { status: "already-stopped"; monitor_id: string }
  | { status: "denied"; monitor_id: string }

type MonitorToolContext = {
  sessionID: string
}

export function createMonitorStop(manager: MonitorManager, _ctx?: unknown): ToolDefinition {
  const stoppedMonitorIds = new Set<string>()

  const formatResult = (result: MonitorStopResult): string => JSON.stringify(result)

  return tool({
    description: "Stop a running monitor owned by the current session.",
    args: {
      monitor_id: tool.schema.string().describe("Monitor ID to stop"),
    },
    async execute(args: MonitorStopArgs, toolContext: MonitorToolContext): Promise<string> {
      const record = manager.get(args.monitor_id)

      if (!record) {
        return formatResult({ status: "already-stopped", monitor_id: args.monitor_id })
      }

      if (record.parentSessionId !== toolContext.sessionID) {
        return formatResult({ status: "denied", monitor_id: args.monitor_id })
      }

      if (record.status === "stopped" || stoppedMonitorIds.has(args.monitor_id)) {
        return formatResult({ status: "already-stopped", monitor_id: args.monitor_id })
      }

      stoppedMonitorIds.add(args.monitor_id)
      await manager.stop(args.monitor_id)

      return formatResult({ status: "stopped", monitor_id: args.monitor_id })
    },
  })
}
