import { computeLineHash } from "./hash-computation"
import { HASHLINE_REF_PATTERN } from "./constants"

export interface LineRef {
  line: number
  hash: string
}

interface HashMismatch {
  line: number
  expected: string
}

const MISMATCH_CONTEXT = 2

const LINE_REF_EXTRACT_PATTERN = /([0-9]+#[ZPMQVRWSNKTXJBYH]{2})/

function normalizeLineRef(ref: string): string {
  const originalTrimmed = ref.trim()
  let trimmed = originalTrimmed
  trimmed = trimmed.replace(/^(?:>>>|[+-])\s*/, "")
  trimmed = trimmed.replace(/\s*#\s*/, "#")
  trimmed = trimmed.replace(/\|.*$/, "")
  trimmed = trimmed.trim()

  if (HASHLINE_REF_PATTERN.test(trimmed)) {
    return trimmed
  }

  const extracted = trimmed.match(LINE_REF_EXTRACT_PATTERN)
  if (extracted) {
    return extracted[1]
  }

  return originalTrimmed
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
  // normalized equals ref.trim() in all error paths — extraction only succeeds for valid refs
  const hashIdx = normalized.indexOf('#')
  if (hashIdx > 0) {
    const prefix = normalized.slice(0, hashIdx)
    const suffix = normalized.slice(hashIdx + 1)
    if (!/^\d+$/.test(prefix) && /^[ZPMQVRWSNKTXJBYH]{2}$/.test(suffix)) {
      throw new Error(
        `Invalid line reference: "${ref}". "${prefix}" is not a line number. ` +
          `Use the actual line number from the read output.`
      )
    }
  }
  throw new Error(
    `Invalid line reference format: "${ref}". Expected format: "{line_number}#{hash_id}"`
  )
}

export function validateLineRef(lines: string[], ref: string): void {
  const { line, hash } = parseLineRefWithHint(ref, lines)

  if (line < 1 || line > lines.length) {
    throw new Error(
      `Line number ${line} out of bounds. File has ${lines.length} lines.`
    )
  }

  const content = lines[line - 1]
  const currentHash = computeLineHash(line, content)

  if (currentHash !== hash) {
    throw new HashlineMismatchError([{ line, expected: hash }], lines)
  }
}

export class HashlineMismatchError extends Error {
  readonly remaps: ReadonlyMap<string, string>

  constructor(
    private readonly mismatches: HashMismatch[],
    private readonly fileLines: string[]
  ) {
    super(HashlineMismatchError.formatMessage(mismatches, fileLines))
    this.name = "HashlineMismatchError"
    const remaps = new Map<string, string>()
    for (const mismatch of mismatches) {
      const actual = computeLineHash(mismatch.line, fileLines[mismatch.line - 1] ?? "")
      remaps.set(`${mismatch.line}#${mismatch.expected}`, `${mismatch.line}#${actual}`)
    }
    this.remaps = remaps
  }

  static formatMessage(mismatches: HashMismatch[], fileLines: string[]): string {
    const mismatchByLine = new Map<number, HashMismatch>()
    for (const mismatch of mismatches) mismatchByLine.set(mismatch.line, mismatch)

    const displayLines = new Set<number>()
    for (const mismatch of mismatches) {
      const low = Math.max(1, mismatch.line - MISMATCH_CONTEXT)
      const high = Math.min(fileLines.length, mismatch.line + MISMATCH_CONTEXT)
      for (let line = low; line <= high; line++) displayLines.add(line)
    }

    const sortedLines = [...displayLines].sort((a, b) => a - b)
    const output: string[] = []
    output.push(
      `${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. ` +
        "Use updated {line_number}#{hash_id} references below (>>> marks changed lines)."
    )
    output.push("")

    let previousLine = -1
    for (const line of sortedLines) {
      if (previousLine !== -1 && line > previousLine + 1) {
        output.push("    ...")
      }
      previousLine = line

      const content = fileLines[line - 1] ?? ""
      const hash = computeLineHash(line, content)
      const prefix = `${line}#${hash}|${content}`
      if (mismatchByLine.has(line)) {
        output.push(`>>> ${prefix}`)
      } else {
        output.push(`    ${prefix}`)
      }
    }

    return output.join("\n")
  }
}

function suggestLineForHash(ref: string, lines: string[]): string | null {
  const hashMatch = ref.trim().match(/#([ZPMQVRWSNKTXJBYH]{2})$/)
  if (!hashMatch) return null
  const hash = hashMatch[1]
  for (let i = 0; i < lines.length; i++) {
    if (computeLineHash(i + 1, lines[i]) === hash) {
      return `Did you mean "${i + 1}#${hash}"?`
    }
  }
  return null
}
function parseLineRefWithHint(ref: string, lines: string[]): LineRef {
  try {
    return parseLineRef(ref)
  } catch (parseError) {
    const hint = suggestLineForHash(ref, lines)
    if (hint && parseError instanceof Error) {
      throw new Error(`${parseError.message} ${hint}`)
    }
    throw parseError
  }
}

export function validateLineRefs(lines: string[], refs: string[]): void {
  const mismatches: HashMismatch[] = []

  for (const ref of refs) {
    const { line, hash } = parseLineRefWithHint(ref, lines)

    if (line < 1 || line > lines.length) {
      throw new Error(`Line number ${line} out of bounds (file has ${lines.length} lines)`)
    }

    const content = lines[line - 1]
    const currentHash = computeLineHash(line, content)
    if (currentHash !== hash) {
      mismatches.push({ line, expected: hash })
    }
  }

  if (mismatches.length > 0) {
    throw new HashlineMismatchError(mismatches, lines)
  }
}
