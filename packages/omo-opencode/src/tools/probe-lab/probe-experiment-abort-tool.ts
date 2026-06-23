import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

export function createProbeExperimentAbortTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Abort a probe-lab experiment and mark its sessions terminated for reporting.",
    args: {
      experiment_id: tool.schema.string(),
      reason: tool.schema.string().max(500),
    },
    async execute(args) {
      const before = ctx.store.listSessionsForExperiment(args.experiment_id).length
      ctx.store.abortExperiment(args.experiment_id, args.reason)
      return JSON.stringify({ experiment_id: args.experiment_id, status: "aborted", sessions_terminated: before })
    },
  })
}
