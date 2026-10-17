import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { appendFile } from "@oh-my-opencode/memory-core/fs"
import { parseFactsExtractionRecord } from "@oh-my-opencode/memory-core"
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
  readonly maxRecords?: number
  readonly maxBytes?: number
  readonly onFailure?: (reason: string) => void
  readonly state?: { readonly cancelled: boolean }
}

export function createFactsRecordTool(input: FactsRecordToolInput): FactsRecordTool {
  let active = true
  let count = 0
  let bytes = 0
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
      if (input.maxRecords !== undefined && count >= input.maxRecords) {
        return reject(`the facts run limit (${input.maxRecords}) has been reached`)
      }
      try {
        const record = parseFactsExtractionRecord(params, count)
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

function errorResult(reason: string): FactsRecordToolResult {
  return {
    content: [{ type: "text", text: `Fact rejected: ${reason}` }],
    details: undefined,
    isError: true,
  }
}
