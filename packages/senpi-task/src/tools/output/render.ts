import type { TranscriptEntry } from "./types"

export const TRANSCRIPT_MAX_CHARS = 30000

const EMPTY_NOTICE = "(no transcript recorded for this task)"

export type RenderOptions = {
  readonly mode: "tail" | "full"
  readonly tailLines: number
}

export type RenderedTranscript = {
  readonly text: string
  readonly truncated: boolean
}

// Render transcript entries to text, then apply tail-line and character-cap trimming. `truncated` is
// true when either the tail cut lines or the char cap elided content, so task_output can flag it.
export function renderTranscript(entries: readonly TranscriptEntry[], options: RenderOptions): RenderedTranscript {
  if (entries.length === 0) return { text: EMPTY_NOTICE, truncated: false }

  const lines = entries.flatMap(renderEntry)
  const tail = options.mode === "tail" ? takeTail(lines, options.tailLines) : { lines, cut: false }
  const joined = tail.lines.join("\n")
  const capped = capText(joined)
  return { text: capped.text, truncated: tail.cut || capped.elided }
}

function renderEntry(entry: TranscriptEntry): readonly string[] {
  if (entry.kind === "assistant") return [`assistant: ${entry.text}`]
  if (entry.kind === "error") return [`error: ${entry.message}`]
  const marker = entry.is_error ? "tool[error]" : "tool"
  return [`${marker}: ${entry.tool}`]
}

function takeTail(lines: readonly string[], tailLines: number): { readonly lines: readonly string[]; readonly cut: boolean } {
  if (tailLines <= 0 || lines.length <= tailLines) return { lines, cut: lines.length > tailLines }
  return { lines: lines.slice(lines.length - tailLines), cut: true }
}

function capText(text: string): { readonly text: string; readonly elided: boolean } {
  if (text.length <= TRANSCRIPT_MAX_CHARS) return { text, elided: false }
  const marker = (elided: number): string => `\n...[elided ${elided} chars]...\n`
  const budget = TRANSCRIPT_MAX_CHARS - marker(text.length).length
  const headLen = Math.floor(budget / 2)
  const tailLen = budget - headLen
  const elidedCount = text.length - headLen - tailLen
  return { text: `${text.slice(0, headLen)}${marker(elidedCount)}${text.slice(text.length - tailLen)}`, elided: true }
}
