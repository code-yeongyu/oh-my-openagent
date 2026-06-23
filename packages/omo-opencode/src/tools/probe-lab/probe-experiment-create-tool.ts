import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"
import type { ExperimentSafetyBudget } from "../../features/probe-lab/experiment-types"

const DESCRIPTION = `Create an experiment that bridges a hypothesis to executable protocol steps with a safety budget.

Each protocol step is an atomic action ({step, action, params}). Safety budget defaults to {max_identities_burned: 3, max_time_s: 300, require_canary: false}. Canary infrastructure is v0.3 — require_canary=true is currently advisory only.`

const HYPOTHESIS_ID_DESC = "Hypothesis id from probe_hypothesis_add"
const NAME_DESC = "Short experiment label"
const DESCRIPTION_DESC = "Optional human-readable description"
const PROTOCOL_DESC = "Ordered list of {step, action, params}"
const EXPECTED_DESC = "Expected outcome description"
const SAFETY_DESC = "Override defaults of safety budget"

const DEFAULT_BUDGET: ExperimentSafetyBudget = {
  max_identities_burned: 3,
  max_time_s: 300,
  require_canary: false,
}

export function createProbeExperimentCreateTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      hypothesis_id: tool.schema.string().describe(HYPOTHESIS_ID_DESC),
      name: tool.schema.string().min(1).max(200).describe(NAME_DESC),
      description: tool.schema.string().optional().describe(DESCRIPTION_DESC),
      protocol: tool.schema.array(tool.schema.object({
        step: tool.schema.number().int().positive(),
        action: tool.schema.string(),
        params: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
      })).min(1).describe(PROTOCOL_DESC),
      expected_outcome: tool.schema.string().optional().describe(EXPECTED_DESC),
      safety_budget: tool.schema.object({
        max_identities_burned: tool.schema.number().int().default(3),
        max_time_s: tool.schema.number().int().default(300),
        require_canary: tool.schema.boolean().default(false),
      }).optional().describe(SAFETY_DESC),
    },
    async execute(args) {
      try {
        const hypothesis = ctx.store.getHypothesis(args.hypothesis_id)
        if (!hypothesis) return `[ERROR] hypothesis not found: ${args.hypothesis_id}`
        const id = `e-${randomUUID()}`
        const budget: ExperimentSafetyBudget = {
          max_identities_burned: args.safety_budget?.max_identities_burned ?? DEFAULT_BUDGET.max_identities_burned,
          max_time_s: args.safety_budget?.max_time_s ?? DEFAULT_BUDGET.max_time_s,
          require_canary: args.safety_budget?.require_canary ?? DEFAULT_BUDGET.require_canary,
        }
        const row = ctx.store.insertExperiment({
          id,
          hypothesis_id: args.hypothesis_id,
          name: args.name,
          description: args.description ?? null,
          protocol: args.protocol,
          expected_outcome: args.expected_outcome ?? null,
          safety_budget: budget,
        })
        return JSON.stringify({
          experiment_id: row.id,
          status: row.status,
          safety_budget_remaining: budget,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_experiment_create failed: ${message}`
      }
    },
  })
}
