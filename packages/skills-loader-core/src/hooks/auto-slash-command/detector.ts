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

export function parseAllSlashCommands(text: string): ParsedSlashCommand[] {
  const ignored = getIgnoredRanges(text)
  const pattern = /(?:^|(?<=\s))\/([a-zA-Z@][\w.:@/-]*)/g
  const results: ParsedSlashCommand[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index
    if (isIgnored(start, ignored)) {
      continue
    }
    const command = match[1]
    const afterCmd = start + 1 + command.length
    const lineBreakMatch = text.slice(afterCmd).search(/[\r\n]/)
    const lineEnd = lineBreakMatch === -1 ? text.length : afterCmd + lineBreakMatch
    const lineRest = text.slice(afterCmd, lineEnd)
    const matchArgs = lineRest.match(/^[^\S\r\n]*(.*)/)
    const args = (matchArgs ? matchArgs[1] : "").trim()
    const raw = text.slice(start, lineEnd)
    results.push({
      command: command.toLowerCase(),
      args,
      raw,
      start,
      end: lineEnd,
    })
  }
  return results
}

export function parseSlashCommand(text: string, commandName?: string): ParsedSlashCommand | null {
  const all = parseAllSlashCommands(text)
  if (commandName !== undefined) {
    const target = commandName.toLowerCase()
    return all.find((c) => c.command === target) ?? null
  }
  return all.length > 0 ? all[0] : null
}

export function isExcludedCommand(command: string): boolean {
  return EXCLUDED_COMMANDS.has(command.toLowerCase())
}

export function detectAllSlashCommands(text: string): ParsedSlashCommand[] {
  return parseAllSlashCommands(text).filter((parsed) => !isExcludedCommand(parsed.command))
}

export function detectSlashCommand(text: string): ParsedSlashCommand | null {
  const all = detectAllSlashCommands(text)
  return all.length > 0 ? all[0] : null
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

export function findMatchingSlashCommandPartIndex(
  parts: Array<{ type: string; text?: string; synthetic?: boolean }>,
  commandName: string
): number {
  const target = commandName.toLowerCase()
  for (let idx = 0; idx < parts.length; idx += 1) {
    const part = parts[idx]
    if (!isRealUserTextPart(part)) continue
    const candidates = parseAllSlashCommands(part.text ?? "")
    if (candidates.some((c) => c.command === target)) {
      return idx
    }
  }
  return -1
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
