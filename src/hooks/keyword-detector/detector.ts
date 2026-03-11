import {
  KEYWORD_DETECTORS,
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
  type KeywordDetector,
} from "./constants"

export interface DetectedKeyword {
  type: "ultrawork" | "search" | "analyze"
  message: string
}

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
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
  detectors: KeywordDetector[] = KEYWORD_DETECTORS,
): string[] {
  const textWithoutCode = removeCodeBlocks(text)
  return detectors.filter(({ pattern }) =>
    pattern.test(textWithoutCode)
  ).map(({ message }) => resolveMessage(message, agentName, modelID))
}

export function detectKeywordsWithType(
  text: string,
  agentName?: string,
  modelID?: string,
  detectors: KeywordDetector[] = KEYWORD_DETECTORS,
): DetectedKeyword[] {
  const textWithoutCode = removeCodeBlocks(text)
  const types: Array<"ultrawork" | "search" | "analyze"> = ["ultrawork", "search", "analyze"]
  return detectors.map(({ pattern, message }, index) => ({
    matches: pattern.test(textWithoutCode),
    type: types[index],
    message: resolveMessage(message, agentName, modelID),
  }))
    .filter((result) => result.matches)
    .map(({ type, message }) => ({ type, message }))
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join(" ")
}
