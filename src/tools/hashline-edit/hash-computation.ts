import { HASHLINE_DICT } from "./constants"

export function computeLineHash(lineNumber: number, content: string): string {
  void lineNumber
  const stripped = content.replace(/\s+/g, "")
  const hash = Bun.hash.xxHash32(stripped)
  const index = hash % 256
  return HASHLINE_DICT[index]
}

export function formatHashLine(lineNumber: number, content: string): string {
  const hash = computeLineHash(lineNumber, content)
  return `${lineNumber}#${hash}:${content}`
}

export function formatHashLines(content: string): string {
  if (!content) return ""
  const lines = content.split("\n")
  return lines.map((line, index) => formatHashLine(index + 1, line)).join("\n")
}
