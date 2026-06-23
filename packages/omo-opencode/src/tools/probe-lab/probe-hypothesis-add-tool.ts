import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const DESCRIPTION = `Register a new hypothesis in the probe-lab falsification ledger.

A hypothesis is a falsifiable claim that probe runs will gather evidence for or against.
Returns the hypothesis_id; pass it to probe_run and probe_hypothesis_evidence to link probes and evidence.`

const TEXT_DESC = "The hypothesis claim, e.g. 'CIF file dereference fails for prompts >= 4000 chars'."
const FALSIFIABILITY_DESC = "Concrete evidence that would refute the hypothesis."
const TEMPLATE_DESC = "Optional pre-built ASPIC+ theory (object) for automated reasoning by probe_hypothesis_evidence."

export function createProbeHypothesisAddTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      text: tool.schema.string().min(1).max(2000).describe(TEXT_DESC),
      falsifiability_criteria: tool.schema.string().min(1).max(2000).describe(FALSIFIABILITY_DESC),
      aspic_theory_template: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().describe(TEMPLATE_DESC),
    },
    async execute(args) {
      try {
        const id = `h-${randomUUID()}`
        const row = ctx.store.insertHypothesis({
          id,
          text: args.text,
          falsifiability_criteria: args.falsifiability_criteria,
          aspic_theory_template: args.aspic_theory_template ?? null,
        })
        return JSON.stringify({
          hypothesis_id: row.id,
          status: row.status,
          created_at: row.created_at,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_hypothesis_add failed: ${message}`
      }
    },
  })
}
