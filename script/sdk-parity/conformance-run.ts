import type { ConformanceContext, EffectEvidence } from "./conformance"
import type { ObservedCall, TableScenario } from "./expectation"
import type { Row } from "./schema"

// The effect-scenario runner of design 7.3. Each table scenario gets a root over fake ports (its setup), the runner calls
// the row's SDK member through a forwarding proxy that records the member actually invoked, and the fakes report every
// port call they observed. P0 ships no SDK call, so the list is empty; slice P1b's drivers supply one run per scenario.
//
// The stream contract (review 6061874518 M3, design 4.4): a member that answers an AsyncIterable is consumed to its one
// terminal event, `{ kind: "end", outcome | failure | cancelled }`; the run's answer is that event's outcome, a failure is
// read as a root refusal, and a stream that ends with no terminal event is a failed run. A scenario's `abort` fires the
// caller's signal after `after_ms` on the fakes' virtual clock, never wall time.

export type ScenarioSetup = {
  readonly root: unknown
  readonly calls: () => readonly ObservedCall[]
  /** The fakes' virtual clock: runs `fire` once `ms` of virtual time has passed. Needed only by an aborting scenario. */
  readonly after?: (ms: number, fire: () => void) => void
}

export type ScenarioRun = { readonly scenario: TableScenario; readonly setup: () => ScenarioSetup }

export const SCENARIO_RUNS: readonly ScenarioRun[] = []

// P0 has no run and no port list of its own: slice P1a's PORT_EFFECTS replaces this, and until then any observed call is
// on an unclassified port and fails (conformance.ts), so an empty table can never pass a run silently.
export const P0_CONTEXT: ConformanceContext = { effects: {} }

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

const field = (value: unknown, key: string): unknown => Reflect.get(Object(value), key)
const isStream = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === "object" && value !== null && Symbol.asyncIterator in value

type Settled = {
  readonly answer: unknown
  readonly terminal?: "outcome" | "failure" | "cancelled"
  readonly missing?: true
}

async function settle(answer: unknown): Promise<Settled> {
  if (!isStream(answer)) return { answer: await answer }
  for await (const event of answer) {
    if (field(event, "kind") !== "end") continue
    if (field(event, "cancelled") === true)
      return { answer: { kind: "error", error: { code: "cancelled" } }, terminal: "cancelled" }
    const failure = field(event, "failure")
    if (failure !== undefined) return { answer: { kind: "error", error: failure }, terminal: "failure" }
    return { answer: { kind: "ok", value: field(event, "outcome") }, terminal: "outcome" }
  }
  return { answer: undefined, missing: true }
}

// A refusal is read from the root failure, or (for a call whose value is the engine's own reply) the value's error field.
function refusalOf(answer: unknown): { readonly code?: string; readonly source?: "root" | "value" } {
  if (field(answer, "kind") === "error") {
    const code = field(field(answer, "error"), "code")
    return { code: typeof code === "string" ? code : "error", source: "root" }
  }
  const error = field(field(answer, "value"), "error")
  const code = typeof error === "string" ? error : field(error, "code")
  return typeof code === "string" ? { code, source: "value" } : {}
}

export async function runEffectScenarios(
  rows: readonly Row[],
  runs: readonly ScenarioRun[] = SCENARIO_RUNS,
): Promise<EffectEvidence[]> {
  const evidence: EffectEvidence[] = []
  for (const { scenario, setup } of runs) {
    const row = rows.find((candidate) => candidate.id === scenario.row)
    const { root, calls, after } = setup()
    const invoked: string[] = []
    let member: unknown = forwarding(root, [], invoked)
    for (const key of (row?.sdk ?? "").split(".")) member = Reflect.get(Object(member), key)
    const controller = new AbortController()
    if (scenario.abort !== undefined) after?.(scenario.abort.after_ms, () => controller.abort())
    const base = {
      scenario: scenario.id,
      row: scenario.row,
      kind: scenario.kind,
      input: scenario.input,
      expect: scenario.expect,
      ...(scenario.target === undefined ? {} : { target: scenario.target }),
      ...(scenario.refusal === undefined ? {} : { refusal: scenario.refusal }),
      ...(scenario.refusal_from === undefined ? {} : { refusalFrom: scenario.refusal_from }),
      ...(scenario.answer === undefined ? {} : { answer: scenario.answer }),
    }
    try {
      const settled = await settle(
        Reflect.apply(member as (input: unknown, options: unknown) => unknown, undefined, [
          scenario.input,
          { signal: controller.signal },
        ]),
      )
      if (settled.missing === true) {
        evidence.push({
          ...base,
          member: invoked.join(","),
          observed: calls(),
          threw: "the stream ended with no terminal event",
        })
        continue
      }
      const { code, source } = refusalOf(settled.answer)
      const isRefusal = field(settled.answer, "kind") === "error" || scenario.refusal_from === "value"
      evidence.push({
        ...base,
        member: invoked.join(","),
        observed: calls(),
        answered: field(settled.answer, "value"),
        ...(code !== undefined && isRefusal ? { code, codeSource: source } : {}),
      })
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
