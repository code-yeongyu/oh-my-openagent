import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { ProbeLabContext } from "../../features/probe-lab/probe-lab-context"

const DESCRIPTION = `Park (suspend investigation of) a question. The reason is appended to the question's tags as 'park-reason:<reason>'. Status transitions to 'parked'.`

const QUESTION_ID_DESC = "Question id"
const REASON_DESC = "Why the question is being parked (max 500 chars)"

export function createProbeQuestionParkTool(ctx: ProbeLabContext): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      question_id: tool.schema.string().describe(QUESTION_ID_DESC),
      reason: tool.schema.string().max(500).describe(REASON_DESC),
    },
    async execute(args) {
      try {
        const question = ctx.store.getQuestion(args.question_id)
        if (!question) return `[ERROR] question not found: ${args.question_id}`
        const previousStatus = question.status
        ctx.store.parkQuestion(args.question_id, args.reason)
        return JSON.stringify({
          question_id: args.question_id,
          previous_status: previousStatus,
          new_status: "parked",
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `[ERROR] probe_question_park failed: ${message}`
      }
    },
  })
}
