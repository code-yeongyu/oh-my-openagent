import { isRealUserTextPart } from "../../shared/internal-initiator-marker"
import {
  EXCLUDED_COMMANDS,
  SLASH_COMMAND_PATTERN_ANYWHERE,
} from "./constants"
import type { ParsedSlashCommand } from "./types"

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "")
}

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const match = text.match(SLASH_COMMAND_PATTERN_ANYWHERE)

  if (!match) {
    return null
  }

  const [fullMatch, boundary, command, args] = match
  const raw = fullMatch.slice(boundary.length)
  const start = (match.index ?? 0) + boundary.length

  return {
    command: command.toLowerCase(),
    args: args.trim(),
    raw,
    start,
    end: start + raw.length,
  }
}

export function isExcludedCommand(command: string): boolean {
  return EXCLUDED_COMMANDS.has(command.toLowerCase())
}

export function detectSlashCommand(text: string): ParsedSlashCommand | null {
  const textWithoutCodeBlocks = removeCodeBlocks(text)

  const parsed = parseSlashCommand(textWithoutCodeBlocks)

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
