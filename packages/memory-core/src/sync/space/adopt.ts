// Insert-only adoption (sync-design §3): text with no shared CRDT history joins a space
// without losing a character. Only insertions are applied; nothing is deleted. A file
// identical to the device's last materialised text is skipped (the space state is taken,
// and a tombstoned item's file is removed, never revived). A changed file is adopted, and
// over a tombstone that adoption counts as an edit concurrent with the delete, so the item
// stays. Case-fold collisions and T1 side files land in the same item; T2 blocks are
// folded per key into the frontmatter (adopt-frontmatter.ts). Adoption is not pure text: the
// plan carries the working text a §5 capture applies (each register with the values the space
// already holds, or a new key's first value) and extraRegisterValues, the differing whole
// values, each a register entry superseding nothing. The caller commits both as ONE update
// through the capture entry point, captureOnDevice(device, itemKey, doc, base, frontier,
// plan.workingText, plan.extraRegisterValues): its optional registerValues argument is the only
// way to commit a plan, under the capture's receipts and replay guard. `rendered` is the predicted item text. No marker or conflict text is ever
// written into the body (§10).
//
// Every file is read as LF text without a leading UTF-8 BOM (normalizeInput). The body shortcut is a
// provable local deletion only: it applies to a main file whose text is a character
// subsequence of what this device last materialised (an in-line word deletion included;
// adopting the shortened line as new text would duplicate the sentence). Side files and history-less mains
// are always line-merged. A source file enters removalCandidates only after the
// independent read-back (read-back.ts) finds every one of its facts in the prediction: every body
// line as many times as the source has it, every frontmatter value an active register entry
// or set element. A candidate is deleted only after confirmRemovals repeats that read-back on
// the committed item. A source that fails the read-back stays on disk and the plan records
// its structured reason in retainedSources; deletion is never silent.

import { splitItem } from "../item/frontmatter"
import type { RegisterValue } from "../item/index"

import { adoptFields, extraValues, registersOf, renderFields, seedFields, type AdoptedFields } from "./adopt-frontmatter"
import { parseSyncConflictName, stripT2Blocks } from "./hub-trace"
import { isOrderedSubsequence, mergeInsertions } from "./merge"
import { firstMissingFact, normalizeInput } from "./read-back"

export interface Snapshot {
  readonly path: string
  readonly text: string
}

export interface ItemState {
  /** Content render of the space's item at the frontier this device materialised; null when absent. */
  readonly currentText: string | null
  readonly tombstoned: boolean
  /** The exact text this device last materialised for the item; null when it never did. */
  readonly lastMaterialised: string | null
  /**
   * The space item's register components per key (activeRegisters(doc)); required, because a
   * joined render alone cannot tell two values from one value containing " / " (review r7 M1).
   */
  readonly registers: ReadonlyMap<string, readonly string[]>
}

export interface RetainedSource {
  readonly path: string
  /** Structured machine-readable reason the source was kept, e.g. the first missing fact. */
  readonly reason: string
}

interface PlanResult {
  /** The item text once the plan is applied; the base text when nothing changes. */
  readonly rendered: string
  /** Register components per key in `rendered`. */
  readonly registers: ReadonlyMap<string, readonly string[]>
  readonly removalCandidates: readonly string[]
  readonly retainedSources: readonly RetainedSource[]
}

export type AdoptionPlan =
  | (PlanResult & { readonly action: "none" | "remove" })
  | (PlanResult & { readonly action: "capture"; readonly workingText: string; readonly extraRegisterValues: readonly RegisterValue[] })

export function planAdoption(
  files: readonly Snapshot[],
  item: ItemState,
  merge: (base: string, incoming: string) => string = mergeInsertions,
): AdoptionPlan {
  const mains: Snapshot[] = []
  const sides: Snapshot[] = []
  for (const file of files) {
    if (parseSyncConflictName(file.path) === null) mains.push(file)
    else sides.push(file)
  }
  const first = mains[0]
  const unchanged =
    item.lastMaterialised !== null &&
    sides.length === 0 &&
    mains.length === 1 &&
    first !== undefined &&
    first.text === item.lastMaterialised
  const base = normalizeInput(item.currentText ?? "")
  if (unchanged) {
    return { action: item.tombstoned ? "remove" : "none", rendered: base, registers: item.registers, removalCandidates: [], retainedSources: [] }
  }
  const fields: AdoptedFields = new Map()
  const baseParsed = splitItem(base)
  seedFields(fields, baseParsed.fm ?? [], item.registers)
  const baseStripped = stripT2Blocks(baseParsed.body)
  adoptFields(fields, baseStripped.entries)
  let body = merge("", baseStripped.body)
  const adoptFile = (raw: string, isMain: boolean): void => {
    const text = normalizeInput(raw)
    const parsed = splitItem(text)
    adoptFields(fields, parsed.fm ?? [])
    const stripped = stripT2Blocks(parsed.body)
    adoptFields(fields, stripped.entries)
    const localDeletion =
      isMain && item.lastMaterialised !== null && isOrderedSubsequence(text, normalizeInput(item.lastMaterialised))
    if (!localDeletion) body = merge(body, stripped.body)
  }
  for (const file of mains) adoptFile(file.text, true)
  for (const file of sides) adoptFile(file.text, false)
  const workingText = renderFields(fields, body, "working")
  const extraRegisterValues = extraValues(fields)
  const rendered = renderFields(fields, body, "final")
  const registers = registersOf(fields)
  const removalCandidates: string[] = []
  const retainedSources: RetainedSource[] = []
  for (const side of sides) {
    const missing = firstMissingFact(rendered, normalizeInput(side.text), registers)
    if (missing === null) removalCandidates.push(side.path)
    else retainedSources.push({ path: side.path, reason: missing })
  }
  if (workingText === base && extraRegisterValues.length === 0) {
    return { action: item.tombstoned ? "remove" : "none", rendered, registers, removalCandidates, retainedSources }
  }
  return { action: "capture", workingText, extraRegisterValues, rendered, registers, removalCandidates, retainedSources }
}
