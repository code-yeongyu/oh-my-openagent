export const TOOL_ARGS_TRUNCATE_LIMIT = 300
export const REDACTED_REASONING_TEXT = "[REDACTED REASONING]"

export type TextTranscriptEntry = {
  readonly kind: "user" | "assistant" | "reasoning" | "error"
  readonly text: string
  readonly captured_at: string
  readonly source_line_id: string
  readonly source_message_id: string
}

export type ToolCallTranscriptEntry = {
  readonly kind: "tool_call"
  readonly name?: string
  readonly argsText?: string
  readonly resultText?: string
  readonly resultOk?: boolean
  readonly captured_at: string
  readonly source_line_id: string
  readonly source_message_id: string
}

export type TranscriptEntry = TextTranscriptEntry | ToolCallTranscriptEntry

export type ProjectedToolCall = {
  readonly callId: string
  readonly name?: string
  readonly argsText?: string
  readonly resultText?: string
  readonly resultOk?: boolean
}

export type ProjectedReasoning = string | { readonly redacted: true }

export type TranscriptProjection =
  | { readonly kind: "user"; readonly messageId: string; readonly text: string }
  | { readonly kind: "error"; readonly messageId: string; readonly text: string }
  | {
      readonly kind: "assistant"
      readonly messageId: string
      readonly textBlocks?: readonly string[]
      readonly reasoningBlocks?: readonly ProjectedReasoning[]
      readonly toolCalls?: readonly ProjectedToolCall[]
    }

function textRow(
  kind: TextTranscriptEntry["kind"],
  text: string,
  capturedAt: string,
  sourceLineId: string,
  sourceMessageId: string,
): TextTranscriptEntry {
  return {
    kind,
    text,
    captured_at: capturedAt,
    source_line_id: sourceLineId,
    source_message_id: sourceMessageId,
  }
}

export function projectTranscriptEntries(
  message: TranscriptProjection,
  capturedAt: string,
): TranscriptEntry[] {
  if (message.kind === "user" || message.kind === "error") {
    if (message.text.trim().length === 0) return []
    return [
      textRow(
        message.kind,
        message.text,
        capturedAt,
        `${message.messageId}:${message.kind}`,
        message.messageId,
      ),
    ]
  }

  const entries: TranscriptEntry[] = []
  const assistantText = (message.textBlocks ?? [])
    .filter((text) => text.trim().length > 0)
    .join("\n")
  if (assistantText.length > 0) {
    entries.push(
      textRow(
        "assistant",
        assistantText,
        capturedAt,
        `${message.messageId}:assistant`,
        message.messageId,
      ),
    )
  }

  for (const [index, reasoning] of (message.reasoningBlocks ?? []).entries()) {
    const text = typeof reasoning === "string" ? reasoning : REDACTED_REASONING_TEXT
    if (text.trim().length === 0) continue
    entries.push(
      textRow(
        "reasoning",
        text,
        capturedAt,
        `${message.messageId}:reasoning:${index}`,
        message.messageId,
      ),
    )
  }

  for (const toolCall of message.toolCalls ?? []) {
    entries.push({
      kind: "tool_call",
      name: toolCall.name,
      argsText: toolCall.argsText?.slice(0, TOOL_ARGS_TRUNCATE_LIMIT),
      resultText: toolCall.resultText,
      resultOk: toolCall.resultOk,
      captured_at: capturedAt,
      source_line_id: `${message.messageId}:tool:${toolCall.callId}`,
      source_message_id: message.messageId,
    })
  }
  return entries
}
