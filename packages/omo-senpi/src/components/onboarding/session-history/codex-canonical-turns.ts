import type { TranscriptContent, TranscriptRecord } from "./transcript-records"

export function extractText(content: TranscriptContent | undefined): string {
  if (typeof content === "string") return content.trim()
  if (content === undefined) return ""
  return content
    .filter((block) => block.type === "text" || block.type === "input_text" || block.type === "output_text")
    .map((block) => block.text?.trim() ?? "")
    .filter((text) => text.length > 0)
    .join("\n")
}

function codexTurnId(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null
  const turnId: unknown = Reflect.get(metadata, "turn_id")
  return typeof turnId === "string" && turnId.trim().length > 0 ? turnId : null
}

/**
 * A Codex response item can carry generated setup text beside the real prompt. Response-user records are
 * suppressed only when a shared turn id and a verbatim `user_message` event prove which prompt was typed.
 */
export function canonicalCodexResponseUserIndices(records: ReadonlyArray<TranscriptRecord>): Set<number> {
  const indices = new Set<number>()
  let canonicalTexts = new Set<string>()
  let responseUsers: Array<{ readonly index: number; readonly turnId: string; readonly text: string }> = []
  const finishTurn = () => {
    const canonicalTurnIds = new Set(
      responseUsers.flatMap((responseUser) => (canonicalTexts.has(responseUser.text) ? [responseUser.turnId] : [])),
    )
    for (const responseUser of responseUsers) {
      if (canonicalTurnIds.has(responseUser.turnId)) indices.add(responseUser.index)
    }
    canonicalTexts = new Set()
    responseUsers = []
  }
  records.forEach((record, index) => {
    const payload = record.payload
    if (record.type === "response_item" && payload?.type === "message" && payload.role === "assistant") {
      finishTurn()
      return
    }
    if (record.type === "event_msg" && payload?.type === "user_message") {
      const text = payload.message?.trim() ?? ""
      if (text.length > 0) canonicalTexts.add(text)
      return
    }
    if (record.type === "response_item" && payload?.type === "message" && payload.role === "user") {
      const turnId = codexTurnId(payload.internal_chat_message_metadata_passthrough)
      const text = extractText(payload.content)
      if (turnId !== null && text.length > 0) responseUsers.push({ index, turnId, text })
    }
  })
  finishTurn()
  return indices
}
