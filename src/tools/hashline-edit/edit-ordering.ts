import { parseLineRef } from "./validation"
import type { HashlineEdit } from "./types"

export function getEditLineNumber(edit: HashlineEdit): number {
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
    case "append":
      return Number.NEGATIVE_INFINITY
    case "prepend":
      return Number.NEGATIVE_INFINITY
    case "replace":
      return Number.NEGATIVE_INFINITY
    default:
      return Number.POSITIVE_INFINITY
  }
}

export function collectLineRefs(edits: HashlineEdit[]): string[] {
  return edits.flatMap((edit) => {
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
      case "append":
      case "prepend":
      case "replace":
        return []
      default:
        return []
    }
  })
}
