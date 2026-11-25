import type { EffectEvidence } from "./conformance"
import type { ObservedCall, TableScenario } from "./expectation"
import type { Row } from "./schema"

// The effect-scenario runner of design 7.3. Each table scenario gets a root over fake ports (its setup), the runner calls
// the row's SDK member through a forwarding proxy that records the member actually invoked, and the fakes report every
// port call they observed. Its records are the only evidence that builds a row. P0 ships no SDK call, so the list is
// empty; slice P1b's drivers supply one run per table scenario.

export type ScenarioRun = {
  readonly scenario: TableScenario
  readonly setup: () => { readonly root: unknown; readonly calls: () => readonly ObservedCall[] }
}

export const SCENARIO_RUNS: readonly ScenarioRun[] = []

function forwarding(target: unknown, path: readonly string[], invoked: string[]): unknown {
  return new Proxy(() => undefined, {
    get: (_shell, key) =>
      typeof key === "string" ? forwarding(Reflect.get(Object(target), key), [...path, key], invoked) : undefined,
    apply: (_shell, _self, args: unknown[]) => {
      invoked.push(path.join("."))
      return typeof target === "function" ? Reflect.apply(target, undefined, args) : undefined
    },
  })
}

const codeOf = (answer: unknown): string | undefined => {
  if (Reflect.get(Object(answer), "kind") !== "error") return undefined
  const code = Reflect.get(Object(Reflect.get(Object(answer), "error")), "code")
  return typeof code === "string" ? code : "error"
}

export async function runEffectScenarios(
  rows: readonly Row[],
  runs: readonly ScenarioRun[] = SCENARIO_RUNS,
): Promise<EffectEvidence[]> {
  const evidence: EffectEvidence[] = []
  for (const { scenario, setup } of runs) {
    const row = rows.find((candidate) => candidate.id === scenario.row)
    const { root, calls } = setup()
    const invoked: string[] = []
    let member: unknown = forwarding(root, [], invoked)
    for (const key of (row?.sdk ?? "").split(".")) member = Reflect.get(Object(member), key)
    const base = {
      scenario: scenario.id,
      row: scenario.row,
      kind: scenario.kind,
      input: scenario.input,
      expect: scenario.expect,
      ...(scenario.refusal === undefined ? {} : { refusal: scenario.refusal }),
    }
    try {
      const answer: unknown = await Reflect.apply(member as (input: unknown) => unknown, undefined, [scenario.input])
      const code = codeOf(answer)
      evidence.push({ ...base, member: invoked.join(","), observed: calls(), ...(code === undefined ? {} : { code }) })
    } catch (error) {
      evidence.push({
        ...base,
        member: invoked.join(","),
        observed: calls(),
        threw: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return evidence
}
