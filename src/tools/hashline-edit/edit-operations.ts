import { parseLineRef, validateLineRef } from "./validation"
import type { HashlineEdit } from "./types"

function unescapeNewlines(text: string): string {
  return text.replace(/\\n/g, "\n")
}

export function applySetLine(lines: string[], anchor: string, newText: string): string[] {
  validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  result[line - 1] = unescapeNewlines(newText)
  return result
}

export function applyReplaceLines(
  lines: string[],
  startAnchor: string,
  endAnchor: string,
  newText: string
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
  const newLines = unescapeNewlines(newText).split("\n")
  result.splice(startLine - 1, endLine - startLine + 1, ...newLines)
  return result
}

export function applyInsertAfter(lines: string[], anchor: string, text: string): string[] {
  validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  const newLines = unescapeNewlines(text).split("\n")
  result.splice(line, 0, ...newLines)
  return result
}

export function applyReplace(content: string, oldText: string, newText: string): string {
  if (!content.includes(oldText)) {
    throw new Error(`Text not found: "${oldText}"`)
  }
  return content.replaceAll(oldText, unescapeNewlines(newText))
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

  for (const edit of sortedEdits) {
    switch (edit.type) {
      case "set_line": {
        validateLineRef(lines, edit.line)
        const { line } = parseLineRef(edit.line)
        lines[line - 1] = unescapeNewlines(edit.text)
        break
      }
      case "replace_lines": {
        validateLineRef(lines, edit.start_line)
        validateLineRef(lines, edit.end_line)
        const { line: startLine } = parseLineRef(edit.start_line)
        const { line: endLine } = parseLineRef(edit.end_line)
        if (startLine > endLine) {
          throw new Error(
            `Invalid range: start line ${startLine} cannot be greater than end line ${endLine}`
          )
        }
        const newLines = unescapeNewlines(edit.text).split("\n")
        lines.splice(startLine - 1, endLine - startLine + 1, ...newLines)
        break
      }
      case "insert_after": {
        validateLineRef(lines, edit.line)
        const { line } = parseLineRef(edit.line)
        const newLines = unescapeNewlines(edit.text).split("\n")
        lines.splice(line, 0, ...newLines)
        break
      }
      case "replace": {
        result = lines.join("\n")
        if (!result.includes(edit.old_text)) {
          throw new Error(`Text not found: "${edit.old_text}"`)
        }
        result = result.replaceAll(edit.old_text, unescapeNewlines(edit.new_text))
        lines = result.split("\n")
        break
      }
    }
  }

  return lines.join("\n")
}
