// Drift delta (reviews r4/r5, lead decision r6): a capture whose baseline was already captured
// carries only what the user changed between the two files THEY wrote (the receipted text and
// the working text). Both are parsed as the user's own item model, never the doc's rendered state,
// and only changed fields are written, on the current document:
// - a removed field is cleared, leaving unseen entries alone;
// - a field of a register key is a whole-value register write (never a text or list merge);
// - a set key edited as a set gets an element delta, so a concurrent removal is not undone;
// - a set key given a value of another kind is a whole-value replacement;
// - the body, the only text, merges as text.

import type { LoroDoc } from "../../crdt/loro-runtime"

import type { FmEntry, FmValue } from "./frontmatter"
import { splitItem } from "./frontmatter"
import type { ItemHistory } from "./history"
import { analyzeHistory } from "./history"
import { applyKey, assertNever, clearKey, editSet, writeNatural } from "./key-writers"
import { BODY_NAME, cidRoot } from "./state"
import { mergeText } from "./three-way"

export async function applyUserDelta(target: LoroDoc, before: string, after: string, unseen: ReadonlySet<string>): Promise<void> {
  const b = splitItem(before)
  const a = splitItem(after)
  const beforeFields = fieldsOf(b.fm)
  const afterFields = fieldsOf(a.fm)
  const history = analyzeHistory(target)
  const keys = [...afterFields.keys(), ...[...beforeFields.keys()].filter((key) => !afterFields.has(key))]
  for (const key of keys) editField(target, key, beforeFields.get(key), afterFields.get(key), history, unseen)
  const bodyBefore = b.body
  const bodyAfter = a.body
  if (bodyBefore === bodyAfter) return
  const current = target.hasContainer(cidRoot(BODY_NAME, "Text")) ? target.getText(BODY_NAME).toString() : ""
  const merged = await mergeText(bodyBefore, bodyAfter, current)
  if (merged !== current) target.getText(BODY_NAME).update(merged)
}

function editField(
  target: LoroDoc,
  key: string,
  before: FmValue | undefined,
  after: FmValue | undefined,
  history: ItemHistory,
  unseen: ReadonlySet<string>,
): void {
  if (sameField(before, after)) return
  if (after === undefined || after.kind === "remove") {
    clearKey(target, key, unseen)
    return
  }
  const kind = history.keys.get(key)?.kind
  if (kind === undefined) {
    writeNatural(target, key, after)
    return
  }
  switch (kind) {
    case "reg":
      applyKey(target, key, after, history, unseen)
      return
    case "set":
      if (after.kind === "set" && before?.kind === "set") {
        const removed = new Set(before.elements.filter((e) => !after.elements.includes(e)))
        const added = after.elements.filter((e) => !before.elements.includes(e))
        editSet(target, key, removed, added, unseen)
        return
      }
      applyKey(target, key, after, history, unseen)
      return
    default:
      return assertNever(kind)
  }
}

function fieldsOf(entries: readonly FmEntry[] | null): Map<string, FmValue> {
  return new Map((entries ?? []).map((entry) => [entry.key, entry.value]))
}

function sameField(a: FmValue | undefined, b: FmValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}
