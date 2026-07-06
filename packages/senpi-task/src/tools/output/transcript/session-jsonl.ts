import type { TranscriptEntry } from "../types"

// Parse a senpi child-session JSONL transcript (docs/session-format.md) into assistant text entries.
// The header line (`type:"session"`, v1/v2/v3) carries no message and is skipped like every other
// non-assistant entry. Unknown entry types and malformed lines are tolerated so a future session
// version never crashes task_output.
export function parseSessionTranscript(text: string): readonly TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (const line of text.split("\n")) {
    const assistantText = assistantTextOf(parseLine(line))
    if (assistantText !== undefined) entries.push({ kind: "assistant", text: assistantText })
  }
  return entries
}

function parseLine(line: string): unknown {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

function assistantTextOf(entry: unknown): string | undefined {
  if (!isRecord(entry) || entry.type !== "message") return undefined
  const message = entry.message
  if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) return undefined
  const text = message.content
    .filter((part: unknown): part is { readonly type: "text"; readonly text: string } => isTextPart(part))
    .map((part) => part.text)
    .join("")
  return text.length > 0 ? text : undefined
}

function isTextPart(part: unknown): part is { readonly type: "text"; readonly text: string } {
  return isRecord(part) && part.type === "text" && typeof part.text === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
