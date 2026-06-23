import { extractCallsFromNormalizedBlock, type ParsedToolCall } from "./invoke-extractor"
import { findCandidateBlocks } from "./scanner"

export type LeakReparseResult = {
  tool_calls?: ParsedToolCall[]
  cleanContent: string
}

export function reparseLeakedContent(content: string): LeakReparseResult {
  if (typeof content !== "string" || content.length === 0) {
    return { cleanContent: content ?? "" }
  }
  const blocks = findCandidateBlocks(content)
  if (blocks.length === 0) {
    return { cleanContent: content }
  }
  const calls: ParsedToolCall[] = []
  for (const b of blocks) {
    calls.push(...extractCallsFromNormalizedBlock(b.normalized))
  }
  let cleaned = ""
  let cursor = 0
  for (const b of blocks) {
    cleaned += content.slice(cursor, b.start)
    cursor = b.end
  }
  cleaned += content.slice(cursor)
  cleaned = cleaned.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  return { tool_calls: calls, cleanContent: cleaned }
}
