import type { EffectEvidence } from "./conformance"
import type { Row } from "./schema"

// The effect-scenario runner of design 7.3 (review 6061267823 H3). Each scenario builds a root over fake ports, the runner
// calls the row's SDK member through a forwarding proxy that records the member actually invoked, and the scenario reads
// the effect its fake port observed. Its records are the only evidence that builds a row. P0 ships no SDK call, so the
// table is empty; slice P1b and later add one entry per input that changes behaviour.

export type EffectScenario = {
  readonly id: string
  readonly capability: string
  readonly input: unknown
  readonly setup: () => { readonly root: unknown; readonly port: string; readonly observe: () => unknown }
}

export const EFFECT_SCENARIOS: readonly EffectScenario[] = []

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
  const error = Reflect.get(Object(answer), "error")
  const code = Reflect.get(Object(error), "code")
  return typeof code === "string" ? code : undefined
}

export async function runEffectScenarios(
  rows: readonly Row[],
  scenarios: readonly EffectScenario[] = EFFECT_SCENARIOS,
): Promise<EffectEvidence[]> {
  const evidence: EffectEvidence[] = []
  for (const scenario of scenarios) {
    const row = rows.find((candidate) => candidate.id === scenario.capability)
    const { root, port, observe } = scenario.setup()
    const invoked: string[] = []
    const proxy = forwarding(root, [], invoked)
    let member: unknown = proxy
    for (const key of (row?.sdk ?? "").split(".")) member = Reflect.get(Object(member), key)
    try {
      const answer: unknown = await Reflect.apply(member as (input: unknown) => unknown, undefined, [scenario.input])
      const code = codeOf(answer)
      evidence.push({
        scenario: scenario.id,
        capability: scenario.capability,
        member: invoked.join(","),
        input: scenario.input,
        status: Reflect.get(Object(answer), "kind") === "error" ? "failed" : "passed",
        effect: { port, observed: observe() },
        ...(code === undefined ? {} : { code }),
      })
    } catch (error) {
      evidence.push({
        scenario: scenario.id,
        capability: scenario.capability,
        member: invoked.join(","),
        input: scenario.input,
        status: "failed",
        code: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return evidence
}
