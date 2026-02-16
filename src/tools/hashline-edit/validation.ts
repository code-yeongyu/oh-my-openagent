import { computeLineHash } from "./hash-computation"

export interface LineRef {
  line: number
  hash: string
}

export function parseLineRef(ref: string): LineRef {
  const match = ref.match(/^(\d+):([0-9a-f]{2})$/)
  if (!match) {
    throw new Error(
      `Invalid line reference format: "${ref}". Expected format: "LINE:HASH" (e.g., "42:a3")`
    )
  }
  return {
    line: Number.parseInt(match[1], 10),
    hash: match[2],
  }
}

export function validateLineRef(lines: string[], ref: string): void {
  const { line, hash } = parseLineRef(ref)

  if (line < 1 || line > lines.length) {
    throw new Error(
      `Line number ${line} out of bounds. File has ${lines.length} lines.`
    )
  }

  const content = lines[line - 1]
  const currentHash = computeLineHash(line, content)

  if (currentHash !== hash) {
    throw new Error(
      `Hash mismatch at line ${line}. Expected hash: ${hash}, current hash: ${currentHash}. ` +
        `Line content may have changed. Current content: "${content}"`
    )
  }
}
