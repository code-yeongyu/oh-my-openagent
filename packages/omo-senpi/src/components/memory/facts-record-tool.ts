import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { appendFile } from "@oh-my-opencode/memory-core/fs"
import { parseFactsExtractionRecord, resolveClaimReceipt, USER_QUOTE_RULE, type ConsentExchange, type FactsPayload, type TranscriptEntry } from "@oh-my-opencode/memory-core"
import { Type, type Static } from "typebox"

export const FACTS_RECORD_TOOL_NAME = "record_fact"

const FactsRecordParams = Type.Object({
  scope: Type.Union([Type.Literal("person"), Type.Literal("project")]),
  person: Type.Optional(Type.Object({
    name: Type.String(),
    aliases: Type.Array(Type.String()),
  }, { additionalProperties: false })),
  text: Type.String(),
  date: Type.String(),
  source: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("agent"), Type.Literal("inferred")], {
    description: "Who the fact came from: user (the user said it), agent (an assistant suggestion or statement), inferred (a conclusion drawn from the conversation). Omitted means inferred.",
  })),
  user_quote: Type.Optional(Type.String({ description: USER_QUOTE_RULE })),
}, { additionalProperties: false })

type FactsRecordParams = Static<typeof FactsRecordParams>
export const factsRecordContract = {
  name: FACTS_RECORD_TOOL_NAME,
  description: "Record one durable fact extracted from the supplied conversation payload.",
  parameters: FactsRecordParams,
}
export type FactsRecordToolResult = AgentToolResult<undefined> & { readonly isError?: boolean }
export type FactsRecordTool = Omit<ToolDefinition<typeof FactsRecordParams, undefined>, "execute" | "renderCall" | "renderResult"> & {
  readonly execute: (toolCallId: string, params: FactsRecordParams) => Promise<FactsRecordToolResult>
  readonly deactivate: () => void
}

type FactsRecordToolInput = {
  readonly extractionPath: string
  /** Each user message in the payload that directly answered an assistant message; a `user` claim must quote one whole reply. */
  readonly exchanges: readonly ConsentExchange[]
  readonly maxRecords?: number
  readonly maxBytes?: number
  /** Every call counts, rejected ones too: it bounds the model's tool turns, not only the records kept. */
  readonly maxCalls?: number
  readonly onCall?: () => void
  readonly onFailure?: (reason: string) => void
  readonly state?: { readonly cancelled: boolean }
}

export function createFactsRecordTool(input: FactsRecordToolInput): FactsRecordTool {
  let active = true
  let count = 0
  let bytes = 0
  let calls = 0
  const reject = (reason: string): FactsRecordToolResult => {
    input.onFailure?.(reason)
    return errorResult(reason)
  }
  return {
    ...factsRecordContract,
    label: "Record fact",
    deactivate: () => { active = false },
    execute: async (_toolCallId, params) => {
      if (!active || input.state?.cancelled === true) return errorResult("the facts run is no longer active")
      if (input.maxCalls !== undefined && calls >= input.maxCalls) {
        return reject(`the facts tool-call limit (${input.maxCalls}) has been reached`)
      }
      calls += 1
      input.onCall?.()
      if (input.maxRecords !== undefined && count >= input.maxRecords) {
        return reject(`the facts run limit (${input.maxRecords}) has been reached`)
      }
      try {
        const { source, user_quote: userQuote, ...fact } = params
        const receipt = resolveClaimReceipt({ source, userQuote }, input.exchanges)
        const record = parseFactsExtractionRecord({ ...fact, receipt }, count)
        const line = `${JSON.stringify(record)}\n`
        const lineBytes = Buffer.byteLength(line, "utf8")
        if (input.maxBytes !== undefined && bytes + lineBytes > input.maxBytes) {
          return reject(`the facts byte limit (${input.maxBytes}) has been reached`)
        }
        // Reserve before the asynchronous append: parallel tool calls share the same budget.
        count += 1
        bytes += lineBytes
        const recordNumber = count
        await appendFile(input.extractionPath, line, "utf8")
        return {
          content: [{ type: "text", text: `Fact recorded (${recordNumber}).` }],
          details: undefined,
        }
      } catch (error) {
        return reject(error instanceof Error ? error.message : String(error))
      }
    },
  }
}

// A user entry counts as a reply only when the entry right before it (reasoning aside) is a non-empty assistant message:
// that text is the proposal it answered. For the first user entry of a queue entry, the one before it is the queue
// entry's lead (the previous delta's last entry), so the usual "proposal, then ok in the next turn" still pairs after
// the previous queue entry was consumed. An image-only (empty) user message, a tool step or an error breaks adjacency.
export function payloadExchanges(payload: FactsPayload): ConsentExchange[] {
  return payload.entries.flatMap((entry) => {
    const exchanges: ConsentExchange[] = []
    let proposal = proposalText(entry.lead)
    for (const item of entry.entries) {
      if (item.kind === "reasoning") continue
      if (item.kind === "user" && proposal !== undefined && item.text.trim().length > 0) exchanges.push({ proposal, reply: item.text })
      proposal = proposalText(item)
    }
    return exchanges
  })
}

function proposalText(item: TranscriptEntry | undefined): string | undefined {
  return item?.kind === "assistant" && item.text.trim().length > 0 ? item.text : undefined
}

function errorResult(reason: string): FactsRecordToolResult {
  return {
    content: [{ type: "text", text: `Fact rejected: ${reason}` }],
    details: undefined,
    isError: true,
  }
}
