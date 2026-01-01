import {
  KEYWORD_DETECTORS,
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
} from "./constants"

export interface DetectedKeyword {
  type: "ultrawork" | "search" | "analyze"
  message: string
}

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

export function detectKeywords(text: string): string[] {
  const textWithoutCode = removeCodeBlocks(text)
  return KEYWORD_DETECTORS.filter(({ pattern }) =>
    pattern.test(textWithoutCode)
  ).map(({ message }) => message)
}

export function detectKeywordsWithType(text: string): DetectedKeyword[] {
  const textWithoutCode = removeCodeBlocks(text)
  return KEYWORD_DETECTORS.filter(({ pattern }) =>
    pattern.test(textWithoutCode)
  ).map(({ message }, index) => {
    const types: Array<"ultrawork" | "search" | "analyze"> = ["ultrawork", "search", "analyze"]
    return {
      type: types[index],
      message,
    }
  })
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join(" ")
}
