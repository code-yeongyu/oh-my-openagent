import { HASH_DICT } from "./constants"

export function computeLineHash(lineNumber: number, content: string): string {
  const stripped = content.replace(/\s+/g, "")
  const hashInput = `${lineNumber}:${stripped}`
  const hash = Bun.hash.xxHash32(hashInput)
  const index = hash % 256
  return HASH_DICT[index]
}

export function formatHashLine(lineNumber: number, content: string): string {
  const hash = computeLineHash(lineNumber, content)
  return `${lineNumber}:${hash}|${content}`
}

export function formatHashLines(content: string): string {
  if (!content) return ""
  const lines = content.split("\n")
  return lines.map((line, index) => formatHashLine(index + 1, line)).join("\n")
}
