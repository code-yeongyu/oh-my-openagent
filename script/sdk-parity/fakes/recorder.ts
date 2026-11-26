import { type Expectation, isSubsetOf, type ObservedCall, type TableScenario } from "../expectation"
import { PORT_OPERATIONS } from "../../../packages/omo-senpi/src/components/omo-sdk/contract/ports"
import type { VirtualClock } from "./clock"

// The one call log every fake of a scenario writes to, in the scenario table's vocabulary (PORT_OPERATIONS), and the
// stimulus each call is answered with: the `result` of the scenario's matching expectation (port, op, args as a subset
// of the call's), else undefined, which each fake answers with its own neutral default. A fake records a call only when
// the core made it; the expectation decides what the fake answers, never what it records. A matching expectation's
// `takes_ms` advances the scenario's virtual clock by that much as the call is recorded, before the fake answers.

export type Recorder = {
  readonly calls: () => readonly ObservedCall[]
  readonly record: (port: string, op: string, args?: Readonly<Record<string, unknown>>) => { readonly result?: unknown }
  readonly given: (port: string) => Readonly<Record<string, unknown>>
}

const isOp = (port: string, op: string): boolean =>
  ((PORT_OPERATIONS as Readonly<Record<string, readonly string[]>>)[port] ?? []).includes(op)

export function createRecorder(scenario: TableScenario, clock?: VirtualClock): Recorder {
  const observed: ObservedCall[] = []
  const expectations: readonly Expectation[] = [
    ...scenario.expect,
    ...(scenario.then ?? []).flatMap((step) => step.expect),
  ]
  return {
    calls: () => observed,
    record: (port, op, args = {}) => {
      // A fake that reaches for an op outside the contract is a fake bug, never evidence.
      if (!isOp(port, op)) throw new Error(`fake ${port}: ${op} is not a port operation`)
      observed.push({ port, op, args })
      const matching = (field: "result" | "takes_ms") =>
        expectations.find(
          (expectation) =>
            expectation.port === port &&
            expectation.op === op &&
            Object.hasOwn(expectation, field) &&
            (expectation.args === undefined || isSubsetOf(expectation.args, args)),
        )
      const takes = matching("takes_ms")?.takes_ms
      if (takes !== undefined) {
        if (clock === undefined) throw new Error(`fake ${port}: ${op} takes time, but the recorder was given no clock`)
        clock.advance(takes)
      }
      const stated = matching("result")
      return stated === undefined ? {} : { result: stated.result }
    },
    given: (port) =>
      Object.assign({}, ...(scenario.given ?? []).filter((given) => given.port === port).map((given) => given.state)),
  }
}
