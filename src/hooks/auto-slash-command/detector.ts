import {
  SLASH_COMMAND_PATTERN,
  EXCLUDED_COMMANDS,
} from "./constants"
import type { ParsedSlashCommand } from "./types"

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "")
}

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim()

  if (!trimmed.startsWith("/")) {
    return null
  }

  const match = trimmed.match(SLASH_COMMAND_PATTERN)
  if (!match) {
    return null
  }

  const [raw, command, args] = match
  return {
    command: command.toLowerCase(),
    args: args.trim(),
    raw,
  }
}

export function isExcludedCommand(command: string): boolean {
  return EXCLUDED_COMMANDS.has(command.toLowerCase())
}

export function detectSlashCommand(text: string): ParsedSlashCommand | null {
  const textWithoutCodeBlocks = removeCodeBlocks(text)
  const trimmed = textWithoutCodeBlocks.trim()

  if (!trimmed.startsWith("/")) {
    return null
  }

  const parsed = parseSlashCommand(trimmed)

  if (!parsed) {
    return null
  }

  if (isExcludedCommand(parsed.command)) {
    return null
  }

  return parsed
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string }>
): string {
  const textParts = parts.filter((p) => p.type === "text")
  const slashPart = textParts.find((p) => (p.text ?? "").trim().startsWith("/"))
  if (slashPart?.text) {
    return slashPart.text
  }

  const nonSyntheticParts = textParts.filter(
    (p) => !(p as { synthetic?: boolean }).synthetic
  )
  if (nonSyntheticParts.length > 0) {
    return nonSyntheticParts.map((p) => p.text || "").join(" ")
  }

  return textParts.map((p) => p.text || "").join(" ")
}

export function findSlashCommandPartIndex(
  parts: Array<{ type: string; text?: string }>
): number {
  for (let idx = 0; idx < parts.length; idx += 1) {
    const part = parts[idx]
    if (part.type !== "text") continue
    if ((part.text ?? "").trim().startsWith("/")) {
      return idx
    }
  }
  return -1
}
