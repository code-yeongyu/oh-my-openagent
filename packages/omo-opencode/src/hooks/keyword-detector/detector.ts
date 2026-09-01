import type { KeywordType } from "../../config/schema/keyword-detector"
import { isRealUserTextPart } from "../../shared/internal-initiator-marker"
import {
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
  KEYWORD_DETECTORS,
} from "./constants"

export interface DetectedKeyword {
  type: KeywordType
  message: string
}

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

const SLASH_COMMAND_LEAD_PATTERN = /^\s*\/[a-zA-Z][\w-]*(?:\s|$)/

export function looksLikeSlashCommand(text: string): boolean {
  return SLASH_COMMAND_LEAD_PATTERN.test(text)
}

function resolveMessage(
  message: string | ((agentName?: string, modelID?: string) => string),
  agentName?: string,
  modelID?: string
): string {
  return typeof message === "function" ? message(agentName, modelID) : message
}

export function detectKeywords(
  text: string,
  agentName?: string,
  modelID?: string,
  disabledKeywords?: ReadonlyArray<KeywordType>,
  enabledExpansions?: ReadonlyArray<KeywordType>,
): string[] {
  return detectKeywordsWithType(text, agentName, modelID, disabledKeywords, enabledExpansions).map(
    ({ message }) => message,
  )
}

export function detectKeywordsWithType(
  text: string,
  agentName?: string,
  modelID?: string,
  disabledKeywords?: ReadonlyArray<KeywordType>,
  enabledExpansions?: ReadonlyArray<KeywordType>,
): DetectedKeyword[] {
  const textWithoutCode = removeCodeBlocks(text)
  const disabled = new Set<KeywordType>(disabledKeywords ?? [])
  // Intersection rule: combo requires BOTH base keywords enabled
  if (disabled.has("ultrawork") || disabled.has("hyperplan")) {
    disabled.add("hyperplan-ultrawork")
  }
  // Allowlist: if enabledExpansions is set, only those types fire
  const allowlist = enabledExpansions ? new Set<KeywordType>(enabledExpansions) : null
  return KEYWORD_DETECTORS.map(({ type, pattern, message }) => ({
    matches: pattern.test(textWithoutCode),
    type,
    message: resolveMessage(message, agentName, modelID),
  }))
    .filter((result) => {
      if (!result.matches) return false
      if (allowlist && !allowlist.has(result.type)) return false
      if (disabled.has(result.type)) return false
      return true
    })
    .map(({ type, message }) => ({ type, message }))
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string; synthetic?: boolean }>
): string {
  return parts
    .filter(isRealUserTextPart)
    .map((p) => p.text || "")
    .join(" ")
}
