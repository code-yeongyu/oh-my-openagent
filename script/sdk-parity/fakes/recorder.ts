import { type Expectation, isSubsetOf, type ObservedCall, type TableScenario } from "../expectation"
import { PORT_OPERATIONS } from "../../../packages/omo-senpi/src/components/omo-sdk/contract/ports"

// The one call log every fake of a scenario writes to, in the scenario table's vocabulary (PORT_OPERATIONS), and the
// stimulus each call is answered with: the `result` of the scenario's matching expectation (port, op, args as a subset
// of the call's), else undefined, which each fake answers with its own neutral default. A fake records a call only when
// the core made it; the expectation decides what the fake answers, never what it records.

export type Recorder = {
  readonly calls: () => readonly ObservedCall[]
  readonly record: (port: string, op: string, args?: Readonly<Record<string, unknown>>) => { readonly result?: unknown }
  readonly given: (port: string) => Readonly<Record<string, unknown>>
}

const isOp = (port: string, op: string): boolean =>
  ((PORT_OPERATIONS as Readonly<Record<string, readonly string[]>>)[port] ?? []).includes(op)

export function createRecorder(scenario: TableScenario): Recorder {
  const observed: ObservedCall[] = []
  // How many calls each stated result has answered: matching results are consumed in order, the last one repeating.
  const answered = new Map<Expectation, number>()
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
      const matching = expectations.filter(
        (expectation) =>
          expectation.port === port &&
          expectation.op === op &&
          Object.hasOwn(expectation, "result") &&
          (expectation.args === undefined || isSubsetOf(expectation.args, args)),
      )
      const stated = matching.find((expectation) => !answered.has(expectation)) ?? matching.at(-1)
      if (stated === undefined) return {}
      answered.set(stated, (answered.get(stated) ?? 0) + 1)
      return { result: stated.result }
    },
    given: (port) =>
      Object.assign({}, ...(scenario.given ?? []).filter((given) => given.port === port).map((given) => given.state)),
  }
}
