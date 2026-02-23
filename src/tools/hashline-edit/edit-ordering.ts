import { parseLineRef } from "./validation"
import type { HashlineEdit } from "./types"

export function getEditLineNumber(edit: HashlineEdit): number {
  switch (edit.op) {
    case "replace":
      return parseLineRef(edit.end ?? edit.pos).line
    case "append":
      return edit.pos ? parseLineRef(edit.pos).line : Number.NEGATIVE_INFINITY
    case "prepend":
      return edit.pos ? parseLineRef(edit.pos).line : Number.NEGATIVE_INFINITY
    default:
      return Number.POSITIVE_INFINITY
  }
}

export function collectLineRefs(edits: HashlineEdit[]): string[] {
  return edits.flatMap((edit) => {
    switch (edit.op) {
      case "replace":
        return edit.end ? [edit.pos, edit.end] : [edit.pos]
      case "append":
      case "prepend":
        return edit.pos ? [edit.pos] : []
      default:
        return []
    }
  })
}
