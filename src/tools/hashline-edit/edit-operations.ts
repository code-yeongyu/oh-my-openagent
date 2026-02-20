import { parseLineRef, validateLineRef, validateLineRefs } from "./validation"
import type { HashlineEdit } from "./types"

const HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*\d+#[A-Z]{2}:/
const DIFF_PLUS_RE = /^[+-](?![+-])/

function stripLinePrefixes(lines: string[]): string[] {
  let hashPrefixCount = 0
  let diffPlusCount = 0
  let nonEmpty = 0

  for (const line of lines) {
    if (line.length === 0) continue
    nonEmpty += 1
    if (HASHLINE_PREFIX_RE.test(line)) hashPrefixCount += 1
    if (DIFF_PLUS_RE.test(line)) diffPlusCount += 1
  }

  if (nonEmpty === 0) {
    return lines
  }

  const stripHash = hashPrefixCount > 0 && hashPrefixCount >= nonEmpty * 0.5
  const stripPlus = !stripHash && diffPlusCount > 0 && diffPlusCount >= nonEmpty * 0.5

  if (!stripHash && !stripPlus) {
    return lines
  }

  return lines.map((line) => {
    if (stripHash) return line.replace(HASHLINE_PREFIX_RE, "")
    if (stripPlus) return line.replace(DIFF_PLUS_RE, "")
    return line
  })
}

function equalsIgnoringWhitespace(a: string, b: string): boolean {
  if (a === b) return true
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "")
}

function leadingWhitespace(text: string): string {
  const match = text.match(/^\s*/)
  return match ? match[0] : ""
}

function restoreLeadingIndent(templateLine: string, line: string): string {
  if (line.length === 0) return line
  const templateIndent = leadingWhitespace(templateLine)
  if (templateIndent.length === 0) return line
  if (leadingWhitespace(line).length > 0) return line
  return `${templateIndent}${line}`
}

function stripInsertAnchorEcho(anchorLine: string, newLines: string[]): string[] {
  if (newLines.length <= 1) return newLines
  if (equalsIgnoringWhitespace(newLines[0], anchorLine)) {
    return newLines.slice(1)
  }
  return newLines
}

function stripRangeBoundaryEcho(
  lines: string[],
  startLine: number,
  endLine: number,
  newLines: string[]
): string[] {
  const replacedCount = endLine - startLine + 1
  if (newLines.length <= 1 || newLines.length <= replacedCount) {
    return newLines
  }

  let out = newLines
  const beforeIdx = startLine - 2
  if (beforeIdx >= 0 && equalsIgnoringWhitespace(out[0], lines[beforeIdx])) {
    out = out.slice(1)
  }

  const afterIdx = endLine
  if (afterIdx < lines.length && out.length > 0 && equalsIgnoringWhitespace(out[out.length - 1], lines[afterIdx])) {
    out = out.slice(0, -1)
  }

  return out
}

function toNewLines(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return stripLinePrefixes(input)
  }
  return stripLinePrefixes(input.split("\n"))
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
  result.splice(line, 0, ...newLines)
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
    case "replace":
      return Number.NEGATIVE_INFINITY
    default:
      return Number.POSITIVE_INFINITY
  }
}

export function applyHashlineEdits(content: string, edits: HashlineEdit[]): string {
  if (edits.length === 0) {
    return content
  }

  const sortedEdits = [...edits].sort((a, b) => getEditLineNumber(b) - getEditLineNumber(a))

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
        lines = applyInsertAfter(lines, edit.line, edit.text)
        break
      }
      case "replace": {
        result = lines.join("\n")
        if (!result.includes(edit.old_text)) {
          throw new Error(`Text not found: "${edit.old_text}"`)
        }
        const replacement = Array.isArray(edit.new_text) ? edit.new_text.join("\n") : edit.new_text
        result = result.replaceAll(edit.old_text, replacement)
        lines = result.split("\n")
        break
      }
    }
  }

  return lines.join("\n")
}
