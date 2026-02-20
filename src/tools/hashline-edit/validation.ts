import { computeLineHash } from "./hash-computation"
import { HASHLINE_REF_PATTERN, HASHLINE_LEGACY_REF_PATTERN } from "./constants"

export interface LineRef {
  line: number
  hash: string
}

const LINE_REF_EXTRACT_PATTERN = /([0-9]+#[ZPMQVRWSNKTXJBYH]{2}|[0-9]+:[0-9a-fA-F]{2,})/

function normalizeLineRef(ref: string): string {
  const trimmed = ref.trim()
  if (HASHLINE_REF_PATTERN.test(trimmed)) {
    return trimmed
  }
  if (HASHLINE_LEGACY_REF_PATTERN.test(trimmed)) {
    return trimmed
  }

  const extracted = trimmed.match(LINE_REF_EXTRACT_PATTERN)
  if (extracted) {
    return extracted[1]
  }

  return trimmed
}

export function parseLineRef(ref: string): LineRef {
  const normalized = normalizeLineRef(ref)
  const match = normalized.match(HASHLINE_REF_PATTERN)
  if (match) {
    return {
      line: Number.parseInt(match[1], 10),
      hash: match[2],
    }
  }
  const legacyMatch = normalized.match(HASHLINE_LEGACY_REF_PATTERN)
  if (legacyMatch) {
    return {
      line: Number.parseInt(legacyMatch[1], 10),
      hash: legacyMatch[2],
    }
  }
  throw new Error(
    `Invalid line reference format: "${ref}". Expected format: "LINE#ID" (e.g., "42#VK")`
  )
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

export function validateLineRefs(lines: string[], refs: string[]): void {
  const mismatches: string[] = []

  for (const ref of refs) {
    const { line, hash } = parseLineRef(ref)

    if (line < 1 || line > lines.length) {
      mismatches.push(`Line number ${line} out of bounds (file has ${lines.length} lines)`) 
      continue
    }

    const content = lines[line - 1]
    const currentHash = computeLineHash(line, content)
    if (currentHash !== hash) {
      mismatches.push(
        `line ${line}: expected ${hash}, current ${currentHash} (${line}#${currentHash}) content: "${content}"`
      )
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Hash mismatches:\n- ${mismatches.join("\n- ")}`)
  }
}
