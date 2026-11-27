import { createHash } from "node:crypto"

import { type ConformanceContext, type EffectEvidence, isBuilt } from "./conformance"
import type { Row } from "./schema"

// Design section 7.4. baseline.original.json records the defects that existed when the gate was introduced and never
// changes; its hash pin is read from the merge base, never from the pull request. unresolved.json is the working
// manifest: a subset of the original and of the merge base's manifest, so a cleared gap cannot come back.

export type BaselineEntry = {
  readonly id: string
  readonly gap: string
  readonly slice: string
  readonly issue: string
  // A gap only one slice may clear (a security-gated input or call): the pull request that removes the entry names that
  // slice in an `SDK-Parity-Slice:` body line, and the gate refuses the removal otherwise.
  readonly clearedOnlyBy?: string
}

export type Baseline = { readonly version: 1; readonly entries: readonly BaselineEntry[] }

export const ORIGINAL_PATH = "script/sdk-parity/baseline.original.json"
export const PIN_PATH = "script/sdk-parity/baseline.original.sha256"
export const UNRESOLVED_PATH = "script/sdk-parity/unresolved.json"

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex")

const countsTowardClosure = (row: Row): boolean => row.kind === "capability"

export type BaselineState = {
  readonly rows: readonly Row[]
  readonly originalText: string | undefined
  readonly pinText: string | undefined
  readonly unresolved: Baseline | undefined
  readonly evidence: readonly EffectEvidence[]
  readonly context: ConformanceContext
  readonly atBase: {
    readonly originalText: string | undefined
    readonly pinText: string | undefined
    readonly unresolved: Baseline | undefined
  }
}

const ids = (baseline: Baseline | undefined): Set<string> => new Set((baseline?.entries ?? []).map((entry) => entry.id))

export function baselineProblems(state: BaselineState): string[] {
  const problems: string[] = []
  if (state.originalText === undefined || state.pinText === undefined || state.unresolved === undefined)
    return [`${ORIGINAL_PATH}, ${PIN_PATH} and ${UNRESOLVED_PATH} must all exist`]
  const original = JSON.parse(state.originalText) as Baseline
  const pin = state.pinText.trim()
  if (state.atBase.originalText === undefined) {
    // The one initialization admission: the merge base has no original, and this pull request creates the original,
    // its pin and the manifest together, with the manifest equal to the original.
    if (sha256(state.originalText) !== pin) problems.push(`${PIN_PATH} is not the sha256 of ${ORIGINAL_PATH}`)
    const missing = [...ids(original)].filter((id) => !ids(state.unresolved).has(id))
    if (missing.length > 0 || ids(state.unresolved).size !== ids(original).size)
      problems.push(`the initializing ${UNRESOLVED_PATH} must equal ${ORIGINAL_PATH}`)
  } else {
    const basePin = state.atBase.pinText?.trim()
    if (state.originalText !== state.atBase.originalText)
      problems.push(`${ORIGINAL_PATH} is written once and never changes; restore it from the merge base`)
    if (basePin === undefined || sha256(state.originalText) !== basePin)
      problems.push(`${ORIGINAL_PATH} does not match the pin read from the merge base`)
    if (pin !== basePin) problems.push(`${PIN_PATH} changed; the pin is read from the merge base and never edited`)
  }
  const atBase = state.atBase.unresolved === undefined ? undefined : ids(state.atBase.unresolved)
  for (const entry of state.unresolved.entries) {
    if (!ids(original).has(entry.id))
      problems.push(
        `${UNRESOLVED_PATH} lists ${entry.id}, which ${ORIGINAL_PATH} lacks; build ${entry.id} instead of adding a gap`,
      )
    else if (atBase !== undefined && !atBase.has(entry.id))
      problems.push(`${UNRESOLVED_PATH} restores ${entry.id}, which the merge base had cleared; keep ${entry.id} built`)
  }
  const unresolved = ids(state.unresolved)
  for (const row of state.rows) {
    if (!countsTowardClosure(row)) continue
    if (!isBuilt(row, state.evidence, state.context) && !unresolved.has(row.id))
      problems.push(
        `row ${row.id} is not built and has no ${UNRESOLVED_PATH} entry; add the SDK call ${row.sdk} and its scenarios`,
      )
    if (isBuilt(row, state.evidence, state.context) && unresolved.has(row.id))
      problems.push(`row ${row.id} is built; remove its ${UNRESOLVED_PATH} entry`)
  }
  return problems
}
