import { parseCdataValue } from "./parser/cdata"
import {
  extractCallsFromNormalizedBlock,
  type ParsedToolCall,
} from "./parser/invoke-extractor"
import {
  reparseLeakedContent,
  type LeakReparseResult,
} from "./parser/leak-reparser"
import { findCandidateBlocks } from "./parser/scanner"

export type { ParsedToolCall } from "./parser/invoke-extractor"
export type { LeakReparseResult } from "./parser/leak-reparser"

export type ParseResult = {
  calls: ParsedToolCall[]
  sawSyntax: boolean
}

export function parseDsmlToolCalls(content: string): ParseResult {
  if (typeof content !== "string" || content.length === 0) {
    return { calls: [], sawSyntax: false }
  }
  const blocks = findCandidateBlocks(content)
  if (blocks.length === 0) {
    return { calls: [], sawSyntax: false }
  }
  const dsmlBlocks = blocks.filter((b) => b.normalized.startsWith("<|DSML|"))
  const legacyBlocks = blocks.filter((b) => !b.normalized.startsWith("<|DSML|"))
  const preferred = dsmlBlocks.length > 0 ? dsmlBlocks : legacyBlocks
  const calls: ParsedToolCall[] = []
  for (const b of preferred) {
    calls.push(...extractCallsFromNormalizedBlock(b.normalized))
  }
  return { calls, sawSyntax: calls.length > 0 }
}

export function parseLeakedDsmlInContent(content: string): LeakReparseResult {
  return reparseLeakedContent(content)
}

export function stripCdata(raw: string): string {
  return parseCdataValue(raw)
}
