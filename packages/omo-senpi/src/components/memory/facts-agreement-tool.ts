import { appendFile } from "@oh-my-opencode/memory-core/fs"
import { parseAgreementRecord } from "@oh-my-opencode/memory-core"
import { Type, type Static } from "typebox"

import type { FactsRecordTool, FactsRecordToolResult } from "./facts-record-tool"

export const FACTS_AGREEMENT_TOOL_NAME = "record_agreement"
const AGREEMENT_RECORD_LIMIT = 32
const AGREEMENT_RECORD_BYTES = 16 * 1024

const FactsAgreementParams = Type.Object({
  action: Type.Union([Type.Literal("new"), Type.Literal("reaffirm")]),
  id: Type.Optional(Type.String()),
  applies: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("project")])),
  text: Type.Optional(Type.String()),
  date: Type.String(),
}, { additionalProperties: false })

type FactsAgreementParams = Static<typeof FactsAgreementParams>

export const factsAgreementContract = {
  name: FACTS_AGREEMENT_TOOL_NAME,
  description: "Record that the person stated a new standing agreement, or repeated a correction an existing agreement already covers.",
  parameters: FactsAgreementParams,
}

export type FactsAgreementTool = Omit<FactsRecordTool, "parameters" | "execute"> & {
  readonly parameters: typeof FactsAgreementParams
  readonly execute: (toolCallId: string, params: FactsAgreementParams) => Promise<FactsRecordToolResult>
}

type FactsAgreementToolInput = {
  readonly extractionPath: string
  readonly knownIds: ReadonlySet<string>
  readonly onFailure?: (reason: string) => void
  readonly state?: { readonly cancelled: boolean }
}

export function createFactsAgreementTool(input: FactsAgreementToolInput): FactsAgreementTool {
  let active = true
  let count = 0
  let bytes = 0
  const reject = (reason: string): FactsRecordToolResult => {
    input.onFailure?.(reason)
    return result(`Agreement rejected: ${reason}`, true)
  }
  return {
    ...factsAgreementContract,
    label: "Record agreement",
    deactivate: () => { active = false },
    execute: async (_toolCallId, params) => {
      if (!active || input.state?.cancelled === true) return result("Agreement rejected: the facts run is no longer active", true)
      if (count >= AGREEMENT_RECORD_LIMIT) return reject(`the agreement limit (${AGREEMENT_RECORD_LIMIT}) has been reached`)
      try {
        const record = parseAgreementRecord(params, count)
        if (record.action === "reaffirm" && !input.knownIds.has(record.id)) {
          return reject(`no agreement has id ${record.id}; use one of the ids in the payload's agreements, or action "new"`)
        }
        const line = `${JSON.stringify(record)}\n`
        const lineBytes = Buffer.byteLength(line, "utf8")
        if (bytes + lineBytes > AGREEMENT_RECORD_BYTES) return reject(`the agreement byte limit (${AGREEMENT_RECORD_BYTES}) has been reached`)
        count += 1
        bytes += lineBytes
        const recordNumber = count
        await appendFile(input.extractionPath, line, "utf8")
        return result(`Agreement recorded (${recordNumber}).`, false)
      } catch (error) {
        return reject(error instanceof Error ? error.message : String(error))
      }
    },
  }
}

function result(text: string, isError: boolean): FactsRecordToolResult {
  return { content: [{ type: "text", text }], details: undefined, ...(isError ? { isError: true } : {}) }
}
