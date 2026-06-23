import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const DESCRIPTION = `Detailed status of a single question with optional hypothesis tree summary. Use include_hypotheses=true to enumerate hypotheses linked via hypotheses.question_id (currently linked via the v0.2 column extension).`

const QUESTION_ID_DESC = "Question id"
const INCLUDE_HYPOTHESES_DESC = "Include linked hypothesis summaries (default true)"
const INCLUDE_EVIDENCE_DESC = "Include evidence count per hypothesis (default false)"

export function createProbeQuestionStatusTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      question_id: tool.schema.string().describe(QUESTION_ID_DESC),
      include_hypotheses: tool.schema.boolean().default(true).describe(INCLUDE_HYPOTHESES_DESC),
      include_evidence_summary: tool.schema.boolean().default(false).describe(INCLUDE_EVIDENCE_DESC),
    },
    async execute(args) {
      try {
        const question = ctx.store.getQuestion(args.question_id)
        if (!question) return `[ERROR] question not found: ${args.question_id}`
        const result: Record<string, unknown> = {
          question: {
            id: question.id,
            text: question.text,
            domain: question.domain,
            status: question.status,
            priority: question.priority,
            tags: question.tags,
            created_at: question.created_at,
            updated_at: question.updated_at,
          },
        }
        if (args.include_hypotheses) {
          const hypotheses = listHypothesesForQuestion(ctx, question.id)
          result.hypotheses = hypotheses.map((h) => {
            const base = {
              id: h.id,
              text: h.text,
              status: h.status,
              confidence: h.confidence,
            }
            if (args.include_evidence_summary) {
              return { ...base, evidence_count: ctx.store.listEvidenceForHypothesis(h.id).length }
            }
            return base
          })
          result.total_hypotheses = hypotheses.length
        }
        return JSON.stringify(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_question_status failed: ${message}`
      }
    },
  })
}

function listHypothesesForQuestion(ctx: ProbeLabContext, questionId: string) {
  const all = ctx.store.listHypotheses({ limit: 1000, offset: 0 }).rows
  return all.filter((h) => (h as unknown as { question_id?: string | null }).question_id === questionId)
}
