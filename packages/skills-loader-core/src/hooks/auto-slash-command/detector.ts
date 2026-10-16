import { isRealUserTextPart } from "../../shared/internal-initiator-marker"
import {
  EXCLUDED_COMMANDS,
  SLASH_COMMAND_PATTERN_ANYWHERE,
} from "./constants"
import type { ParsedSlashCommand } from "./types"

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const INLINE_CODE_PATTERN = /`[^`\n]*`/g

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "")
}

function getIgnoredRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  CODE_BLOCK_PATTERN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CODE_BLOCK_PATTERN.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
    if (m[0].length === 0) {
      CODE_BLOCK_PATTERN.lastIndex += 1
    }
  }
  INLINE_CODE_PATTERN.lastIndex = 0
  while ((m = INLINE_CODE_PATTERN.exec(text)) !== null) {
    const start = m.index
    const end = start + m[0].length
    const insideFence = ranges.some((r) => start >= r.start && start < r.end)
    if (!insideFence) {
      ranges.push({ start, end })
    }
    if (m[0].length === 0) {
      INLINE_CODE_PATTERN.lastIndex += 1
    }
  }
  return ranges
}

function isIgnored(index: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((r) => index >= r.start && index < r.end)
}

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const ignored = getIgnoredRanges(text)
  const pattern = new RegExp(SLASH_COMMAND_PATTERN_ANYWHERE.source, "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1
      continue
    }
    const [fullMatch, boundary, command, args] = match
    if (!command) {
      continue
    }
    const start = (match.index ?? 0) + boundary.length
    if (isIgnored(start, ignored)) {
      continue
    }
    const raw = fullMatch.slice(boundary.length)
    return {
      command: command.toLowerCase(),
      args: (args ?? "").trim(),
      raw,
      start,
      end: start + raw.length,
    }
  }
  return null
}

export function isExcludedCommand(command: string): boolean {
  return EXCLUDED_COMMANDS.has(command.toLowerCase())
}

export function detectSlashCommand(text: string): ParsedSlashCommand | null {
  const parsed = parseSlashCommand(text)

  if (!parsed) {
    return null
  }

  if (isExcludedCommand(parsed.command)) {
    return null
  }

  return parsed
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string; synthetic?: boolean }>
): string {
  const textParts = parts.filter(isRealUserTextPart)
  const slashPart = textParts.find((p) => (p.text ?? "").trim().startsWith("/"))
  if (slashPart?.text) {
    return slashPart.text
  }

  return textParts.map((p) => p.text || "").join(" ")
}

export function findSlashCommandPartIndex(
  parts: Array<{ type: string; text?: string; synthetic?: boolean }>
): number {
  for (let idx = 0; idx < parts.length; idx += 1) {
    const part = parts[idx]
    if (!isRealUserTextPart(part)) continue
    if (parseSlashCommand(part.text ?? "") === null) continue
    return idx
  }
  return -1
}
