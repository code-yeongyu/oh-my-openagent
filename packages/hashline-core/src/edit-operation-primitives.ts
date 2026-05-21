import { autocorrectReplacementLines } from "./autocorrect-replacement-lines"
import {
  restoreLeadingIndent,
  stripInsertAnchorEcho,
  stripInsertBeforeEcho,
  stripInsertBoundaryEcho,
  stripRangeBoundaryEcho,
  toNewLines,
} from "./edit-text-normalization"
import { parseLineRef, validateLineRef } from "./validation"

interface EditApplyOptions {
  skipValidation?: boolean
}

function shouldValidate(options?: EditApplyOptions): boolean {
  return options?.skipValidation !== true
}

export function applySetLine(
  lines: string[],
  anchor: string,
  newText: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  const originalLine = lines[line - 1] ?? ""
  const corrected = autocorrectReplacementLines([originalLine], toNewLines(newText))
  const replacement = corrected.map((entry, idx) => {
    if (idx !== 0) return entry
    return restoreLeadingIndent(originalLine, entry)
  })
  result.splice(line - 1, 1, ...replacement)
  return result
}

export function applyReplaceLines(
  lines: string[],
  startAnchor: string,
  endAnchor: string,
  newText: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) {
    validateLineRef(lines, startAnchor)
    validateLineRef(lines, endAnchor)
  }

  const { line: startLine } = parseLineRef(startAnchor)
  const { line: endLine } = parseLineRef(endAnchor)

  if (startLine > endLine) {
    throw new Error(
      `Invalid range: start line ${startLine} cannot be greater than end line ${endLine}`
    )
  }

  const result = [...lines]
  const originalRange = lines.slice(startLine - 1, endLine)
  const stripped = stripRangeBoundaryEcho(lines, startLine, endLine, toNewLines(newText))
  const corrected = autocorrectReplacementLines(originalRange, stripped)
  const restored = corrected.map((entry, idx) => {
    if (idx !== 0) return entry
    return restoreLeadingIndent(lines[startLine - 1] ?? "", entry)
  })
  result.splice(startLine - 1, endLine - startLine + 1, ...restored)
  return result
}

export function applyInsertAfter(
  lines: string[],
  anchor: string,
  text: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  const newLines = stripInsertAnchorEcho(lines[line - 1], toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`append (anchored) requires non-empty text for ${anchor}`)
  }
  result.splice(line, 0, ...newLines)
  return result
}

export function applyInsertBefore(
  lines: string[],
  anchor: string,
  text: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  const newLines = stripInsertBeforeEcho(lines[line - 1], toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`prepend (anchored) requires non-empty text for ${anchor}`)
  }
  result.splice(line - 1, 0, ...newLines)
  return result
}

export function applyAppend(lines: string[], text: string | string[]): string[] {
  const normalized = toNewLines(text)
  if (normalized.length === 0) {
    throw new Error("append requires non-empty text")
  }
  if (lines.length === 1 && lines[0] === "") {
    return [...normalized]
  }
  return [...lines, ...normalized]
}

export function applyPrepend(lines: string[], text: string | string[]): string[] {
  const normalized = toNewLines(text)
  if (normalized.length === 0) {
    throw new Error("prepend requires non-empty text")
  }
  if (lines.length === 1 && lines[0] === "") {
    return [...normalized]
  }
  return [...normalized, ...lines]
}
