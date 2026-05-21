import type { AppendEdit, HashlineEdit, PrependEdit, ReplaceEdit } from "./types"

type HashlineToolOp = "replace" | "append" | "prepend"

export interface RawHashlineEdit {
  op?: HashlineToolOp
  pos?: string
  end?: string
  lines?: string | string[] | null
}

function normalizeAnchor(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

function requireLines(edit: RawHashlineEdit, index: number): string | string[] {
  if (edit.lines === undefined) {
    throw new Error(`Edit ${index}: lines is required for ${edit.op ?? "unknown"}`)
  }
  if (edit.lines === null) {
    return []
  }
  return edit.lines
}

function requireLine(anchor: string | undefined, index: number, op: HashlineToolOp): string {
  if (!anchor) {
    throw new Error(`Edit ${index}: ${op} requires at least one anchor line reference (pos or end)`)
  }
  return anchor
}

function normalizeReplaceEdit(edit: RawHashlineEdit, index: number): HashlineEdit {
  const pos = normalizeAnchor(edit.pos)
  const end = normalizeAnchor(edit.end)
  const anchor = requireLine(pos ?? end, index, "replace")
  const lines = requireLines(edit, index)

  const normalized: ReplaceEdit = {
    op: "replace",
    pos: anchor,
    lines,
  }
  if (end) normalized.end = end
  return normalized
}

function normalizeAppendEdit(edit: RawHashlineEdit, index: number): HashlineEdit {
  const pos = normalizeAnchor(edit.pos)
  const end = normalizeAnchor(edit.end)
  const anchor = pos ?? end
  const lines = requireLines(edit, index)

  const normalized: AppendEdit = {
    op: "append",
    lines,
  }
  if (anchor) normalized.pos = anchor
  return normalized
}

function normalizePrependEdit(edit: RawHashlineEdit, index: number): HashlineEdit {
  const pos = normalizeAnchor(edit.pos)
  const end = normalizeAnchor(edit.end)
  const anchor = pos ?? end
  const lines = requireLines(edit, index)

  const normalized: PrependEdit = {
    op: "prepend",
    lines,
  }
  if (anchor) normalized.pos = anchor
  return normalized
}

export function normalizeHashlineEdits(rawEdits: RawHashlineEdit[]): HashlineEdit[] {
  return rawEdits.map((rawEdit, index) => {
    const edit = rawEdit ?? {}

    switch (edit.op) {
      case "replace":
        return normalizeReplaceEdit(edit, index)
      case "append":
        return normalizeAppendEdit(edit, index)
      case "prepend":
        return normalizePrependEdit(edit, index)
      default:
        throw new Error(
          `Edit ${index}: unsupported op "${String(edit.op)}". Legacy format was removed; use op/pos/end/lines.`
        )
    }
  })
}
