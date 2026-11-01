import { getString, isRecord } from "@oh-my-opencode/comment-checker-core"

export type CheckerStringEdit = {
  readonly old_string: string
  readonly new_string: string
}

export function readCheckerEdits(value: unknown): readonly CheckerStringEdit[] | undefined {
  if (!Array.isArray(value)) return undefined
  const edits: CheckerStringEdit[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const oldString = getString(item, ["old_string", "oldString"])
    const newString = getString(item, ["new_string", "newString"])
    if (oldString === undefined || newString === undefined) continue
    edits.push({ old_string: oldString, new_string: newString })
  }
  return edits.length > 0 ? edits : undefined
}
