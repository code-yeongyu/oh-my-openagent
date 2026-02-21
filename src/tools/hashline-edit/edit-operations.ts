import { parseLineRef, validateLineRef, validateLineRefs } from "./validation"
import type { HashlineEdit } from "./types"
import {
  restoreLeadingIndent,
  stripInsertAnchorEcho,
  stripInsertBeforeEcho,
  stripInsertBoundaryEcho,
  stripRangeBoundaryEcho,
  toNewLines,
} from "./edit-text-normalization"

export interface HashlineApplyReport {
  content: string
  noopEdits: number
  deduplicatedEdits: number
}

export function applySetLine(lines: string[], anchor: string, newText: string | string[]): string[] {
  validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  const replacement = toNewLines(newText).map((entry, idx) => {
    if (idx !== 0) return entry
    return restoreLeadingIndent(lines[line - 1], entry)
  })
  result.splice(line - 1, 1, ...replacement)
  return result
}

export function applyReplaceLines(
  lines: string[],
  startAnchor: string,
  endAnchor: string,
  newText: string | string[]
): string[] {
  validateLineRef(lines, startAnchor)
  validateLineRef(lines, endAnchor)

  const { line: startLine } = parseLineRef(startAnchor)
  const { line: endLine } = parseLineRef(endAnchor)

  if (startLine > endLine) {
    throw new Error(
      `Invalid range: start line ${startLine} cannot be greater than end line ${endLine}`
    )
  }

  const result = [...lines]
  const stripped = stripRangeBoundaryEcho(lines, startLine, endLine, toNewLines(newText))
  const restored = stripped.map((entry, idx) => {
    if (idx !== 0) return entry
    return restoreLeadingIndent(lines[startLine - 1], entry)
  })
  result.splice(startLine - 1, endLine - startLine + 1, ...restored)
  return result
}

export function applyInsertAfter(lines: string[], anchor: string, text: string | string[]): string[] {
  validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  const newLines = stripInsertAnchorEcho(lines[line - 1], toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`insert_after requires non-empty text for ${anchor}`)
  }
  result.splice(line, 0, ...newLines)
  return result
}

export function applyInsertBefore(lines: string[], anchor: string, text: string | string[]): string[] {
  validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  const newLines = stripInsertBeforeEcho(lines[line - 1], toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`insert_before requires non-empty text for ${anchor}`)
  }
  result.splice(line - 1, 0, ...newLines)
  return result
}

export function applyInsertBetween(
  lines: string[],
  afterAnchor: string,
  beforeAnchor: string,
  text: string | string[]
): string[] {
  validateLineRef(lines, afterAnchor)
  validateLineRef(lines, beforeAnchor)
  const { line: afterLine } = parseLineRef(afterAnchor)
  const { line: beforeLine } = parseLineRef(beforeAnchor)
  if (beforeLine <= afterLine) {
    throw new Error(`insert_between requires after_line (${afterLine}) < before_line (${beforeLine})`)
  }

  const result = [...lines]
  const newLines = stripInsertBoundaryEcho(lines[afterLine - 1], lines[beforeLine - 1], toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`insert_between requires non-empty text for ${afterAnchor}..${beforeAnchor}`)
  }
  result.splice(beforeLine - 1, 0, ...newLines)
  return result
}

export function applyReplace(content: string, oldText: string, newText: string | string[]): string {
  if (!content.includes(oldText)) {
    throw new Error(`Text not found: "${oldText}"`)
  }
  const replacement = Array.isArray(newText) ? newText.join("\n") : newText
  return content.replaceAll(oldText, replacement)
}

function getEditLineNumber(edit: HashlineEdit): number {
  switch (edit.type) {
    case "set_line":
      return parseLineRef(edit.line).line
    case "replace_lines":
      return parseLineRef(edit.end_line).line
    case "insert_after":
      return parseLineRef(edit.line).line
    case "insert_before":
      return parseLineRef(edit.line).line
    case "insert_between":
      return parseLineRef(edit.before_line).line
    case "replace":
      return Number.NEGATIVE_INFINITY
    default:
      return Number.POSITIVE_INFINITY
  }
}

function normalizeEditPayload(payload: string | string[]): string {
  return toNewLines(payload).join("\n")
}

function dedupeEdits(edits: HashlineEdit[]): { edits: HashlineEdit[]; deduplicatedEdits: number } {
  const seen = new Set<string>()
  const deduped: HashlineEdit[] = []
  let deduplicatedEdits = 0

  for (const edit of edits) {
    const key = (() => {
      switch (edit.type) {
        case "set_line":
          return `set_line|${edit.line}|${normalizeEditPayload(edit.text)}`
        case "replace_lines":
          return `replace_lines|${edit.start_line}|${edit.end_line}|${normalizeEditPayload(edit.text)}`
        case "insert_after":
          return `insert_after|${edit.line}|${normalizeEditPayload(edit.text)}`
        case "insert_before":
          return `insert_before|${edit.line}|${normalizeEditPayload(edit.text)}`
        case "insert_between":
          return `insert_between|${edit.after_line}|${edit.before_line}|${normalizeEditPayload(edit.text)}`
        case "replace":
          return `replace|${edit.old_text}|${normalizeEditPayload(edit.new_text)}`
      }
    })()

    if (seen.has(key)) {
      deduplicatedEdits += 1
      continue
    }
    seen.add(key)
    deduped.push(edit)
  }

  return { edits: deduped, deduplicatedEdits }
}

export function applyHashlineEditsWithReport(content: string, edits: HashlineEdit[]): HashlineApplyReport {
  if (edits.length === 0) {
    return {
      content,
      noopEdits: 0,
      deduplicatedEdits: 0,
    }
  }

  const dedupeResult = dedupeEdits(edits)
  const sortedEdits = [...dedupeResult.edits].sort((a, b) => getEditLineNumber(b) - getEditLineNumber(a))

  let noopEdits = 0

  let result = content
  let lines = result.split("\n")

  const refs = sortedEdits.flatMap((edit) => {
    switch (edit.type) {
      case "set_line":
        return [edit.line]
      case "replace_lines":
        return [edit.start_line, edit.end_line]
      case "insert_after":
        return [edit.line]
      case "insert_before":
        return [edit.line]
      case "insert_between":
        return [edit.after_line, edit.before_line]
      case "replace":
        return []
      default:
        return []
    }
  })
  validateLineRefs(lines, refs)

  for (const edit of sortedEdits) {
    switch (edit.type) {
      case "set_line": {
        lines = applySetLine(lines, edit.line, edit.text)
        break
      }
      case "replace_lines": {
        lines = applyReplaceLines(lines, edit.start_line, edit.end_line, edit.text)
        break
      }
      case "insert_after": {
        const next = applyInsertAfter(lines, edit.line, edit.text)
        if (next.join("\n") === lines.join("\n")) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "insert_before": {
        const next = applyInsertBefore(lines, edit.line, edit.text)
        if (next.join("\n") === lines.join("\n")) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "insert_between": {
        const next = applyInsertBetween(lines, edit.after_line, edit.before_line, edit.text)
        if (next.join("\n") === lines.join("\n")) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "replace": {
        result = lines.join("\n")
        if (!result.includes(edit.old_text)) {
          throw new Error(`Text not found: "${edit.old_text}"`)
        }
        const replacement = Array.isArray(edit.new_text) ? edit.new_text.join("\n") : edit.new_text
        const replaced = result.replaceAll(edit.old_text, replacement)
        if (replaced === result) {
          noopEdits += 1
          break
        }
        result = replaced
        lines = result.split("\n")
        break
      }
    }
  }

  return {
    content: lines.join("\n"),
    noopEdits,
    deduplicatedEdits: dedupeResult.deduplicatedEdits,
  }
}

export function applyHashlineEdits(content: string, edits: HashlineEdit[]): string {
  return applyHashlineEditsWithReport(content, edits).content
}
