import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const DESCRIPTION = `List hypotheses from the probe-lab ledger with their evidence tally, or fetch a single hypothesis by id.

Use status_filter='refuted' to enumerate dead-end hypotheses already ruled out — saves time by avoiding re-tested claims. Pass hypothesis_id for an exact lookup; it overrides status_filter.`

const HYPOTHESIS_ID_DESC = "Specific hypothesis id to fetch (overrides status_filter)"
const STATUS_FILTER_DESC = "Restrict to a specific status"
const LIMIT_DESC = "Page size (1..100, default 20)"
const OFFSET_DESC = "Pagination offset"

export function createProbeHypothesisStatusTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      hypothesis_id: tool.schema.string().optional().describe(HYPOTHESIS_ID_DESC),
      status_filter: tool.schema.enum(["active", "confirmed", "refuted", "parked"]).optional().describe(STATUS_FILTER_DESC),
      limit: tool.schema.number().int().min(1).max(100).default(20).describe(LIMIT_DESC),
      offset: tool.schema.number().int().min(0).default(0).describe(OFFSET_DESC),
    },
    async execute(args) {
      try {
        if (args.hypothesis_id) {
          const single = ctx.store.getHypothesis(args.hypothesis_id)
          if (!single) {
            return JSON.stringify({ hypotheses: [], total_count: 0, has_more: false })
          }
          const evidence = ctx.store.listEvidenceForHypothesis(single.id)
          return JSON.stringify({
            hypotheses: [
              {
                id: single.id,
                text: single.text,
                status: single.status,
                confidence: single.confidence,
                evidence_count: evidence.length,
                last_updated: single.updated_at,
              },
            ],
            total_count: 1,
            has_more: false,
          })
        }
        const { rows, total } = ctx.store.listHypotheses({
          status_filter: args.status_filter,
          limit: args.limit,
          offset: args.offset,
        })
        return JSON.stringify({
          hypotheses: rows.map((row) => ({
            id: row.id,
            text: row.text,
            status: row.status,
            confidence: row.confidence,
            evidence_count: row.evidence_count,
            last_updated: row.updated_at,
          })),
          total_count: total,
          has_more: args.offset + rows.length < total,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_hypothesis_status failed: ${message}`
      }
    },
  })
}
