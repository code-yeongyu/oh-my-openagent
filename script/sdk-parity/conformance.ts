import type { Row } from "./schema"

// Design 7.2, "a row's call is real": a row counted as built has, for its inputs, effect scenarios the fake ports
// observed, and no outcome of its scenarios is the stub code `not_implemented`. A refusal scenario alone never certifies
// a call. A row is counted as built when it is not in unresolved.json.

export type ConformanceOutcome = { readonly scenario: string; readonly code?: string }

export function conformanceProblems(
  rows: readonly Row[],
  unresolved: ReadonlySet<string>,
  outcomes: readonly ConformanceOutcome[],
): string[] {
  const problems: string[] = []
  const byScenario = new Map(outcomes.map((outcome) => [outcome.scenario, outcome]))
  for (const row of rows) {
    if (row.kind !== "capability" || unresolved.has(row.id)) continue
    if (row.scenarios.effect.length === 0)
      problems.push(
        row.scenarios.refusal.length > 0
          ? `row ${row.id}'s only scenarios are refusals; add an effect scenario for each input of ${row.sdk}`
          : `row ${row.id} counts as built with no effect scenario; add one for each input of ${row.sdk}`,
      )
    for (const id of [...row.scenarios.effect, ...row.scenarios.refusal]) {
      const outcome = byScenario.get(id)
      if (outcome === undefined) problems.push(`row ${row.id} names scenario ${id}, which did not run`)
      else if (outcome.code === "not_implemented")
        problems.push(`row ${row.id}: scenario ${id} answered not_implemented; ${row.sdk} is a stub, build it`)
    }
  }
  return problems
}
