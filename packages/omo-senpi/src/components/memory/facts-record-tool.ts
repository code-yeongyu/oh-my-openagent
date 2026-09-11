import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { appendFile } from "@oh-my-opencode/memory-core/fs"
import { parseFactsExtractionRecord } from "@oh-my-opencode/memory-core"
import { Type, type Static } from "typebox"

export const FACTS_RECORD_TOOL_NAME = "record_fact"

const FactsRecordParams = Type.Union([
  Type.Object({
    scope: Type.Literal("person"),
    person: Type.Object({
      name: Type.String(),
      aliases: Type.Array(Type.String()),
    }, { additionalProperties: false }),
    text: Type.String(),
    date: Type.String(),
  }, { additionalProperties: false }),
  Type.Object({
    scope: Type.Literal("project"),
    text: Type.String(),
    date: Type.String(),
  }, { additionalProperties: false }),
])

type FactsRecordParams = Static<typeof FactsRecordParams>
export type FactsRecordToolResult = AgentToolResult<undefined> & { readonly isError?: boolean }
export type FactsRecordTool = Omit<ToolDefinition<typeof FactsRecordParams, undefined>, "execute" | "renderCall" | "renderResult"> & {
  readonly execute: (toolCallId: string, params: FactsRecordParams) => Promise<FactsRecordToolResult>
  readonly deactivate: () => void
}

type FactsRecordToolInput = {
  readonly extractionPath: string
  readonly maxRecords?: number
  readonly state?: { readonly cancelled: boolean }
}

export function createFactsRecordTool(input: FactsRecordToolInput): FactsRecordTool {
  let active = true
  let count = 0
  return {
    name: FACTS_RECORD_TOOL_NAME,
    label: "Record fact",
    description: "Record one durable fact extracted from the supplied conversation payload.",
    parameters: FactsRecordParams,
    deactivate: () => { active = false },
    execute: async (_toolCallId, params) => {
      if (!active || input.state?.cancelled === true) return errorResult("the facts run is no longer active")
      if (input.maxRecords !== undefined && count >= input.maxRecords) {
        return errorResult(`the facts run limit (${input.maxRecords}) has been reached`)
      }
      try {
        const record = parseFactsExtractionRecord(params, count)
        await appendFile(input.extractionPath, `${JSON.stringify(record)}\n`, "utf8")
        count += 1
        return {
          content: [{ type: "text", text: `Fact recorded (${count}).` }],
          details: undefined,
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
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
