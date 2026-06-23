import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const BUDGETS = { session: 3, experiment: 3, provider: 10, day: 20 }

export function createProbePoolBurnBudgetTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: "Return read-only probe-lab burn budget status from quarantine audit events.",
    args: {
      scope: tool.schema.enum(["session", "experiment", "day", "provider"]),
      scope_id: tool.schema.string().optional(),
    },
    async execute(args) {
      const since = args.scope === "day" || args.scope === "provider" ? startOfUtcDaySeconds() : undefined
      const burned = ctx.store.countAuditLog({ entity_type: "identity", action: "quarantine", since })
      const budget = BUDGETS[args.scope]
      const remaining = Math.max(0, budget - burned)
      return JSON.stringify({
        scope: args.scope,
        scope_id: args.scope_id ?? null,
        budget_remaining: remaining,
        budget_total: budget,
        identities_burned: burned,
        estimated_runway_s: remaining > 0 ? remaining * 3600 : 0,
        warnings: burned >= budget ? ["burn budget exhausted"] : burned / budget >= 0.8 ? ["burn budget nearly exhausted"] : [],
      })
    },
  })
}

function startOfUtcDaySeconds(): number {
  const now = new Date()
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000)
}
