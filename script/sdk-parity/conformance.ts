import { type Expectation, expectationProblems, type ObservedCall } from "./expectation"
import type { Row } from "./schema"

// Design 7.2, "a row's call is real" (reviews 6061267823 H3, 6061624223 H1; amendment 5): a row is built only by typed
// evidence from a run at the head. Each record ties one table scenario to its row, the SDK member the run actually
// invoked, the input it passed and the calls the fake ports observed. A record passes only when those calls match the
// scenario's expected effect, and every optional input has a passing pair of scenarios that differ in it alone.

export type EffectEvidence = {
  readonly scenario: string
  readonly row: string
  readonly kind: "effect" | "refusal"
  readonly member: string
  readonly input: Readonly<Record<string, unknown>>
  readonly expect: readonly Expectation[]
  readonly observed: readonly ObservedCall[]
  readonly refusal?: string
  readonly code?: string
  readonly threw?: string
}

export function recordProblems(row: Row, record: EffectEvidence): string[] {
  const where = `row ${row.id}: scenario ${record.scenario}`
  if (record.code === "not_implemented") return [`${where} answered not_implemented; ${row.sdk} is a stub, build it`]
  if (record.threw !== undefined) return [`${where} threw ${record.threw}`]
  if (record.row !== row.id || record.member !== row.sdk)
    return [`${where} ran ${record.member} for ${record.row}, not ${row.sdk}`]
  if (record.kind === "refusal" && record.code !== record.refusal)
    return [`${where} answered ${record.code ?? "success"}, not the refusal ${record.refusal ?? "(none named)"}`]
  if (record.kind === "effect" && record.code !== undefined)
    return [`${where} answered ${record.code} where an effect was expected`]
  return expectationProblems(record.expect, record.observed).map((problem) => `${where}: ${problem}`)
}

// Coverage is computed, never declared: an optional input is covered by two passing records of the row whose inputs
// differ in that field alone and that differ in kind or expected effect. Required inputs and inert fields are exempt.
function coverageProblems(row: Row, passing: readonly EffectEvidence[], inert: ReadonlySet<string>): string[] {
  const same = (a: EffectEvidence, b: EffectEvidence, field: string): boolean =>
    [...new Set([...Object.keys(a.input), ...Object.keys(b.input)])]
      .filter((key) => key !== field)
      .every((key) => JSON.stringify(a.input[key]) === JSON.stringify(b.input[key]))
  return Object.keys(row.input.properties)
    .filter((field) => !row.input.required.includes(field) && !inert.has(`${row.id}.${field}`))
    .filter(
      (field) =>
        !passing.some((a) =>
          passing.some(
            (b) =>
              a !== b &&
              JSON.stringify(a.input[field]) !== JSON.stringify(b.input[field]) &&
              same(a, b, field) &&
              (a.kind !== b.kind || JSON.stringify(a.expect) !== JSON.stringify(b.expect)),
          ),
        ),
    )
    .map((field) => `row ${row.id}: input ${field} has no pair of passing scenarios that differ in it alone; add one`)
}

export function evidenceProblems(
  row: Row,
  evidence: readonly EffectEvidence[],
  inert: ReadonlySet<string> = new Set(),
): string[] {
  const problems: string[] = []
  if (row.scenarios.effect.length === 0)
    problems.push(
      row.scenarios.refusal.length > 0
        ? `row ${row.id}'s only scenarios are refusals; add an effect scenario for each input of ${row.sdk}`
        : `row ${row.id} has no effect scenario; add one for each input of ${row.sdk}`,
    )
  const passing: EffectEvidence[] = []
  for (const id of [...row.scenarios.effect, ...row.scenarios.refusal]) {
    const record = evidence.find((candidate) => candidate.scenario === id)
    if (record === undefined) {
      problems.push(`row ${row.id}: scenario ${id} has no run record at the head`)
      continue
    }
    const found = recordProblems(row, record)
    problems.push(...found)
    if (found.length === 0) passing.push(record)
  }
  if (row.scenarios.effect.length > 0) problems.push(...coverageProblems(row, passing, inert))
  return problems
}

export const isBuilt = (row: Row, evidence: readonly EffectEvidence[]): boolean =>
  row.today === "yes" && evidenceProblems(row, evidence).length === 0

// Every capability row not in unresolved.json counts as built and must carry that evidence.
export function conformanceProblems(
  rows: readonly Row[],
  unresolved: ReadonlySet<string>,
  evidence: readonly EffectEvidence[],
  inert: ReadonlySet<string> = new Set(),
): string[] {
  return rows
    .filter((row) => row.kind === "capability" && !unresolved.has(row.id))
    .flatMap((row) => evidenceProblems(row, evidence, inert))
}
