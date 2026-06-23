import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { formatProbeMetrics } from "../../features/probe-lab/metrics-formatter"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

export function createProbeMetricsGetTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Return probe-lab metrics as Prometheus scrape text or JSON.",
    args: {
      format: tool.schema.enum(["prometheus", "json"]).default("prometheus"),
    },
    async execute(args) {
      return formatProbeMetrics(ctx.store.collectProbeMetrics(), args.format ?? "prometheus")
    },
  })
}
