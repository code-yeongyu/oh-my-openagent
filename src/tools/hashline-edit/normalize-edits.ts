import type { HashlineEdit } from "./types"

export interface RawHashlineEdit {
  type?:
    | "set_line"
    | "replace_lines"
    | "insert_after"
    | "insert_before"
    | "insert_between"
    | "replace"
    | "append"
    | "prepend"
  line?: string
  start_line?: string
  end_line?: string
  after_line?: string
  before_line?: string
  text?: string | string[]
  old_text?: string
  new_text?: string | string[]
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value
  }
  return undefined
}

function requireText(edit: RawHashlineEdit, index: number): string | string[] {
  const text = edit.text ?? edit.new_text
  if (text === undefined) {
    throw new Error(`Edit ${index}: text is required for ${edit.type ?? "unknown"}`)
  }
  return text
}

function requireLine(anchor: string | undefined, index: number, op: string): string {
  if (!anchor) {
    throw new Error(`Edit ${index}: ${op} requires at least one anchor line reference`)
  }
  return anchor
}

export function normalizeHashlineEdits(rawEdits: RawHashlineEdit[]): HashlineEdit[] {
  const normalized: HashlineEdit[] = []

  for (let index = 0; index < rawEdits.length; index += 1) {
    const edit = rawEdits[index] ?? {}
    const type = edit.type

    switch (type) {
      case "set_line": {
        const anchor = firstDefined(edit.line, edit.start_line, edit.end_line, edit.after_line, edit.before_line)
        normalized.push({
          type: "set_line",
          line: requireLine(anchor, index, "set_line"),
          text: requireText(edit, index),
        })
        break
      }
      case "replace_lines": {
        const startAnchor = firstDefined(edit.start_line, edit.line, edit.after_line)
        const endAnchor = firstDefined(edit.end_line, edit.line, edit.before_line)

        if (!startAnchor && !endAnchor) {
          throw new Error(`Edit ${index}: replace_lines requires start_line or end_line`)
        }

        if (startAnchor && endAnchor) {
          normalized.push({
            type: "replace_lines",
            start_line: startAnchor,
            end_line: endAnchor,
            text: requireText(edit, index),
          })
        } else {
          normalized.push({
            type: "set_line",
            line: requireLine(startAnchor ?? endAnchor, index, "replace_lines"),
            text: requireText(edit, index),
          })
        }
        break
      }
      case "insert_after": {
        const anchor = firstDefined(edit.line, edit.after_line, edit.end_line, edit.start_line)
        normalized.push({
          type: "insert_after",
          line: requireLine(anchor, index, "insert_after"),
          text: requireText(edit, index),
        })
        break
      }
      case "insert_before": {
        const anchor = firstDefined(edit.line, edit.before_line, edit.start_line, edit.end_line)
        normalized.push({
          type: "insert_before",
          line: requireLine(anchor, index, "insert_before"),
          text: requireText(edit, index),
        })
        break
      }
      case "insert_between": {
        const afterLine = firstDefined(edit.after_line, edit.line, edit.start_line)
        const beforeLine = firstDefined(edit.before_line, edit.end_line, edit.line)
        normalized.push({
          type: "insert_between",
          after_line: requireLine(afterLine, index, "insert_between.after_line"),
          before_line: requireLine(beforeLine, index, "insert_between.before_line"),
          text: requireText(edit, index),
        })
        break
      }
      case "replace": {
        const oldText = edit.old_text
        const newText = edit.new_text ?? edit.text
        if (!oldText) {
          throw new Error(`Edit ${index}: replace requires old_text`)
        }
        if (newText === undefined) {
          throw new Error(`Edit ${index}: replace requires new_text or text`)
        }
        normalized.push({ type: "replace", old_text: oldText, new_text: newText })
        break
      }
      case "append": {
        normalized.push({ type: "append", text: requireText(edit, index) })
        break
      }
      case "prepend": {
        normalized.push({ type: "prepend", text: requireText(edit, index) })
        break
      }
      default: {
        throw new Error(`Edit ${index}: unsupported type "${String(type)}"`)
      }
    }
  }

  return normalized
}
