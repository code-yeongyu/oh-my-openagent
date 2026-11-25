import type { Row } from "./schema"

// Design 7.2, "a row's call is real", with review 6061267823 H3: a row is built only by typed evidence from a run at the
// head. Each record ties one scenario to its capability, the SDK member the run actually invoked, the input it passed and
// the effect the fake ports observed. A scenario named by a row with no record, a failed record, a record whose member is
// not the row's call, an answer of the stub code `not_implemented`, or a run with no observed effect does not build it.

export type EffectEvidence = {
  readonly scenario: string
  readonly capability: string
  readonly member: string
  readonly input: unknown
  readonly status: "passed" | "failed"
  readonly effect?: { readonly port: string; readonly observed: unknown }
  readonly code?: string
}

export function evidenceProblems(row: Row, evidence: readonly EffectEvidence[]): string[] {
  const problems: string[] = []
  if (row.scenarios.effect.length === 0)
    problems.push(
      row.scenarios.refusal.length > 0
        ? `row ${row.id}'s only scenarios are refusals; add an effect scenario for each input of ${row.sdk}`
        : `row ${row.id} has no effect scenario; add one for each input of ${row.sdk}`,
    )
  for (const id of row.scenarios.effect) {
    const record = evidence.find((candidate) => candidate.scenario === id)
    if (record === undefined) problems.push(`row ${row.id}: effect scenario ${id} has no run record at the head`)
    else if (record.code === "not_implemented")
      problems.push(`row ${row.id}: scenario ${id} answered not_implemented; ${row.sdk} is a stub, build it`)
    else if (record.status !== "passed") problems.push(`row ${row.id}: scenario ${id} failed at the head`)
    else if (record.capability !== row.id || record.member !== row.sdk)
      problems.push(`row ${row.id}: scenario ${id} ran ${record.member} for ${record.capability}, not ${row.sdk}`)
    else if (record.effect === undefined || record.effect.observed === undefined)
      problems.push(`row ${row.id}: scenario ${id} observed no effect on a fake port`)
  }
  return problems
}

export const isBuilt = (row: Row, evidence: readonly EffectEvidence[]): boolean =>
  row.today === "yes" && evidenceProblems(row, evidence).length === 0

// Every capability row not in unresolved.json counts as built and must carry that evidence.
export function conformanceProblems(
  rows: readonly Row[],
  unresolved: ReadonlySet<string>,
  evidence: readonly EffectEvidence[],
): string[] {
  return rows
    .filter((row) => row.kind === "capability" && !unresolved.has(row.id))
    .flatMap((row) => evidenceProblems(row, evidence))
}
