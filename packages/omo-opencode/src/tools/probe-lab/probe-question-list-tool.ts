import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const DESCRIPTION = `List research questions, optionally filtered by domain or status. Returns paginated summaries with total_count and has_more.`

const DOMAIN_DESC = "Filter by investigation domain"
const STATUS_DESC = "Filter by status"
const LIMIT_DESC = "Page size (1..100, default 20)"
const OFFSET_DESC = "Pagination offset"

export function createProbeQuestionListTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      domain: tool.schema.enum(["llm_reverse", "anti_bot", "signup_automation", "fingerprint", "general"]).optional().describe(DOMAIN_DESC),
      status_filter: tool.schema.enum(["open", "answered", "parked", "superseded"]).optional().describe(STATUS_DESC),
      limit: tool.schema.number().int().min(1).max(100).default(20).describe(LIMIT_DESC),
      offset: tool.schema.number().int().min(0).default(0).describe(OFFSET_DESC),
    },
    async execute(args) {
      try {
        const { rows, total } = ctx.store.listQuestions({
          status_filter: args.status_filter,
          domain: args.domain,
          limit: args.limit,
          offset: args.offset,
        })
        return JSON.stringify({
          questions: rows.map((row) => ({
            id: row.id,
            text: row.text,
            domain: row.domain,
            status: row.status,
            priority: row.priority,
            created_at: row.created_at,
            updated_at: row.updated_at,
          })),
          total_count: total,
          has_more: args.offset + rows.length < total,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_question_list failed: ${message}`
      }
    },
  })
}
