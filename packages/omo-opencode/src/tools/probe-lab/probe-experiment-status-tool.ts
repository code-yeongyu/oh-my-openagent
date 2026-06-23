import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

export function createProbeExperimentStatusTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Check experiment state with optional session list.",
    args: {
      experiment_id: tool.schema.string(),
      include_sessions: tool.schema.boolean().default(true),
    },
    async execute(args) {
      const experiment = ctx.store.getExperiment(args.experiment_id)
      if (!experiment) return `[ERROR] experiment not found: ${args.experiment_id}`
      return JSON.stringify({
        experiment,
        sessions: args.include_sessions ? ctx.store.listSessionsForExperiment(args.experiment_id) : [],
      })
    },
  })
}
