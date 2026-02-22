import { dedupeEdits } from "./edit-deduplication"
import { collectLineRefs, getEditLineNumber } from "./edit-ordering"
import type { HashlineEdit } from "./types"
import {
  applyAppend,
  applyInsertAfter,
  applyInsertBefore,
  applyInsertBetween,
  applyPrepend,
  applyReplace,
  applyReplaceLines,
  applySetLine,
} from "./edit-operation-primitives"
import { validateLineRefs } from "./validation"

export interface HashlineApplyReport {
  content: string
  noopEdits: number
  deduplicatedEdits: number
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
  let lines = result.length === 0 ? [] : result.split("\n")

  const refs = collectLineRefs(sortedEdits)
  validateLineRefs(lines, refs)

  for (const edit of sortedEdits) {
    switch (edit.type) {
      case "set_line": {
        lines = applySetLine(lines, edit.line, edit.text, { skipValidation: true })
        break
      }
      case "replace_lines": {
        lines = applyReplaceLines(lines, edit.start_line, edit.end_line, edit.text, { skipValidation: true })
        break
      }
      case "insert_after": {
        const next = applyInsertAfter(lines, edit.line, edit.text, { skipValidation: true })
        if (next.join("\n") === lines.join("\n")) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "insert_before": {
        const next = applyInsertBefore(lines, edit.line, edit.text, { skipValidation: true })
        if (next.join("\n") === lines.join("\n")) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "insert_between": {
        const next = applyInsertBetween(lines, edit.after_line, edit.before_line, edit.text, { skipValidation: true })
        if (next.join("\n") === lines.join("\n")) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "append": {
        const next = applyAppend(lines, edit.text)
        if (next.join("\n") === lines.join("\n")) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "prepend": {
        const next = applyPrepend(lines, edit.text)
        if (next.join("\n") === lines.join("\n")) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "replace": {
        result = lines.join("\n")
        const replaced = applyReplace(result, edit.old_text, edit.new_text)
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

export {
  applySetLine,
  applyReplaceLines,
  applyInsertAfter,
  applyInsertBefore,
  applyInsertBetween,
  applyReplace,
} from "./edit-operation-primitives"
