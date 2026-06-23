import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const DESCRIPTION = `Register a new research question — the ROOT of an investigation tree under which hypotheses and experiments are grouped.

Returns the question_id; pass it to probe_hypothesis_add and probe_experiment_create to associate downstream entities. Domain narrows the search space (llm_reverse, anti_bot, signup_automation, fingerprint, general).`

const TEXT_DESC = "The research question, e.g. 'What triggers DeepSeek empty SSE responses on large prompts?'"
const DOMAIN_DESC = "Investigation domain"
const PRIORITY_DESC = "1 (highest) to 5 (lowest); default 3"
const TAGS_DESC = "Optional tags for cross-domain grouping"

export function createProbeQuestionAddTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      text: tool.schema.string().min(1).max(2000).describe(TEXT_DESC),
      domain: tool.schema.enum(["llm_reverse", "anti_bot", "signup_automation", "fingerprint", "general"]).default("general").describe(DOMAIN_DESC),
      priority: tool.schema.number().int().min(1).max(5).default(3).describe(PRIORITY_DESC),
      tags: tool.schema.array(tool.schema.string()).optional().describe(TAGS_DESC),
    },
    async execute(args) {
      try {
        const id = `q-${randomUUID()}`
        const row = ctx.store.insertQuestion({
          id,
          text: args.text,
          domain: args.domain,
          priority: args.priority,
          tags: args.tags,
        })
        return JSON.stringify({
          question_id: row.id,
          status: row.status,
          domain: row.domain,
          priority: row.priority,
          created_at: row.created_at,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_question_add failed: ${message}`
      }
    },
  })
}
