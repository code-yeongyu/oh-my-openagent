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

const SCENARIO_RUNS: readonly ScenarioRun[] = []

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

type Settled = { readonly answer: unknown } | { readonly broken: string }

// Design 4.4: a stream ends with exactly one terminal event, the last one, carrying exactly one of outcome, failure or
// cancelled. Anything else (no end, an event after the end, two ends, an end with none or several of them) is broken.
async function settle(answer: unknown): Promise<Settled> {
  if (!isStream(answer)) return { answer: await answer }
  const events: unknown[] = []
  for await (const event of answer) events.push(event)
  const ends = events.filter((event) => field(event, "kind") === "end")
  if (ends.length === 0) return { broken: "the stream ended with no terminal event" }
  if (ends.length > 1) return { broken: `the stream sent ${ends.length} terminal events` }
  const [end] = ends
  if (events.at(-1) !== end) return { broken: "the stream sent an event after its terminal event" }
  const parts = (["outcome", "failure", "cancelled"] as const).filter((key) => field(end, key) !== undefined)
  if (parts.length !== 1)
    return {
      broken: `the terminal event carries ${parts.length === 0 ? "none" : parts.join(" and ")} of outcome, failure, cancelled`,
    }
  if (parts[0] === "cancelled")
    return field(end, "cancelled") === true
      ? { answer: { kind: "error", error: { code: "cancelled" } } }
      : { broken: "cancelled must be true" }
  if (parts[0] === "failure") return { answer: { kind: "error", error: field(end, "failure") } }
  return { answer: { kind: "ok", value: field(end, "outcome") } }
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

type Call = {
  readonly input: Readonly<Record<string, unknown>>
  readonly refusal_from?: "root" | "value"
  readonly kind: "effect" | "refusal"
}

async function invoke(
  member: unknown,
  call: Call,
  signal: AbortSignal,
): Promise<{
  readonly code?: string
  readonly codeSource?: "root" | "value"
  readonly answered?: unknown
  readonly threw?: string
}> {
  try {
    const settled = await settle(
      Reflect.apply(member as (input: unknown, options: unknown) => unknown, undefined, [call.input, { signal }]),
    )
    if ("broken" in settled) return { threw: settled.broken }
    const { code, source } = refusalOf(settled.answer)
    const isRefusal = field(settled.answer, "kind") === "error" || call.refusal_from === "value"
    return {
      answered: settled.answer,
      ...(code !== undefined && isRefusal ? { code, codeSource: source } : {}),
    }
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) }
  }
}

// Every call of a scenario runs on the same fixture, in order: the first, then each `then` step on the state the one
// before it left. Each call's evidence carries only the port calls observed during that call.
export async function runEffectScenarios(
  rows: readonly Row[],
  runs: readonly ScenarioRun[] = SCENARIO_RUNS,
): Promise<EffectEvidence[]> {
  const evidence: EffectEvidence[] = []
  for (const { scenario, setup } of runs) {
    const row = rows.find((candidate) => candidate.id === scenario.row)
    const { root, calls, after } = setup()
    const invoked: string[] = []
    const memberOf = (): unknown => {
      let member: unknown = forwarding(root, [], invoked)
      for (const key of (row?.sdk ?? "").split(".")) member = Reflect.get(Object(member), key)
      return member
    }
    const controller = new AbortController()
    if (scenario.abort !== undefined) after?.(scenario.abort.after_ms, () => controller.abort())
    const sequence = [scenario, ...(scenario.then ?? [])]
    const records: EffectEvidence[] = []
    for (const [index, step] of sequence.entries()) {
      const seen = calls().length
      const before = invoked.length
      const result = await invoke(memberOf(), step, controller.signal)
      records.push({
        scenario: index === 0 ? scenario.id : `${scenario.id}#step${index + 1}`,
        row: scenario.row,
        kind: step.kind,
        member: invoked.slice(before).join(","),
        input: step.input,
        expect: step.expect,
        observed: calls().slice(seen),
        ...(scenario.target === undefined ? {} : { target: scenario.target }),
        ...(step.refusal === undefined ? {} : { refusal: step.refusal }),
        ...(step.refusal_from === undefined ? {} : { refusalFrom: step.refusal_from }),
        ...(step.answer === undefined ? {} : { answer: step.answer }),
        ...result,
      })
    }
    const [first, ...steps] = records
    if (first !== undefined) evidence.push(steps.length === 0 ? first : { ...first, steps })
  }
  return evidence
}
