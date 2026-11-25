// The one definition of an expected effect (design 7.2 and 7.3, amendment 5; field names as slice P1a's scenario table
// wrote them). A scenario names its row, its input, and the calls the fake ports of design 4.6 must observe. Matching:
// `args` is a subset of the observed call's arguments, `count` defaults to 1 and 0 means never called, order is not
// enforced, and `result` is what the fake answers (the stimulus), so it never takes part in equality.

export type Expectation = {
  readonly port: string
  readonly op: string
  readonly args?: Readonly<Record<string, unknown>>
  readonly count?: number
  readonly result?: unknown
}

// Design 4.6: one injected fault at a time, each meaningful on the ports listed here (a lost reply on the host socket,
// the relay and the gateway store, where a committed reservation's reply is lost, a lock timeout on the store, unauthorized from the account session and the device service, a timeout read
// from the clock, a refusal by the peer device). A fault on any other port is a scenario error.
const FAULT_PORTS = {
  lost_reply: ["host", "remote", "store"],
  lock_timeout: ["store"],
  unauthorized: ["session", "deviceService"],
  timeout: ["clock"],
  refused: ["remote"],
} as const satisfies Readonly<Record<string, readonly string[]>>

export type FaultName = keyof typeof FAULT_PORTS

export type Fault = {
  readonly port: string
  readonly op: string
  readonly fault: FaultName
  /** The Nth call of that op (default 1). */
  readonly occurrence?: number
}

export type ScenarioStep = {
  readonly input: Readonly<Record<string, unknown>>
  readonly kind: "effect" | "refusal"
  readonly refusal?: string
  readonly refusal_from?: "root" | "value"
  /** The expected answer of this step, a subset of the whole ok answer (a retry answering the first call's identity). */
  readonly answer?: Readonly<Record<string, unknown>>
  readonly expect: readonly Expectation[]
  /** One fault at a time (design 4.6). */
  readonly fault?: Fault
}

export type TableScenario = {
  /** `<row id>/<slug>`: stable, never reused for another behaviour. */
  readonly id: string
  readonly row: string
  readonly kind: "effect" | "refusal"
  readonly input: Readonly<Record<string, unknown>>
  /** The input is outside the call's input schema on purpose; such a scenario is a refusal with `invalid_arguments`. */
  readonly invalid?: true
  readonly refusal?: string
  /** Where the refusal code is read: the root failure (default) or the error field of the value the call answers, for a
   * call whose value is the engine's own reply. */
  readonly refusal_from?: "root" | "value"
  readonly expect: readonly Expectation[]
  /** The principal the root is built for (security design 3); absent, the root's default. */
  readonly principal?: { readonly kind: string } & Readonly<Record<string, unknown>>
  /** Root options the scenario's root is built with: a selector or an origin the cell is about. */
  readonly root?: Readonly<Record<string, unknown>>
  /** An approved behaviour change of the security design's section 10; its evidence flag selects what is asserted. */
  readonly change?: string
  /** Declarative state of a fake port before the call: sessions it lists, a stored idempotency record, a device's flag. */
  readonly given?: readonly { readonly port: string; readonly state: Readonly<Record<string, unknown>> }[]
  /** One fault at a time (design 4.6). */
  readonly fault?: Fault
  /** Where the addressed thread lives, so a matched pair of 7.3 is two scenarios with the same input. */
  readonly target?: "this_device" | "other_device"
  /** Calls made after the first, in order, on the state the first left (a retry under the same key after a lost reply). */
  readonly then?: readonly ScenarioStep[]
  /** The caller's signal fires this long after the call, on the virtual clock (design 4.4); the scenario must state with
   * `count: 0` the effect that must not have happened. */
  readonly abort?: { readonly after_ms: number }
  /** A subset of the WHOLE ok answer the call resolved to, in either of the design's shapes: a thread call's flat
   * contract (`{ thread, ... }`) or `{ value }` for every other namespace. Checked beside `expect`, never instead of it. */
  readonly answer?: Readonly<Record<string, unknown>>
  /** Today's answer, kept until the named slice makes the target contract pass (design 7.3). */
  readonly retires_with?: string
}

export type ScenarioTableFile = {
  readonly domain: string
  /** `<row id>.<field>`: an input field with no behaviour of its own, and why. */
  readonly inert: Readonly<Record<string, string>>
  readonly scenarios: readonly TableScenario[]
}

export type ObservedCall = {
  readonly port: string
  readonly op: string
  readonly args: Readonly<Record<string, unknown>>
}

export type PortOperations = Readonly<Record<string, readonly string[]>>

const isSubset = (expected: unknown, observed: unknown): boolean => {
  if (typeof expected !== "object" || expected === null || Array.isArray(expected))
    return JSON.stringify(expected) === JSON.stringify(observed)
  if (typeof observed !== "object" || observed === null) return false
  return Object.entries(expected).every(([key, value]) => isSubset(value, Reflect.get(observed, key)))
}

export const isSubsetOf = (expected: unknown, observed: unknown): boolean => isSubset(expected, observed)

export function expectationProblems(expect: readonly Expectation[], observed: readonly ObservedCall[]): string[] {
  const problems: string[] = []
  for (const expectation of expect) {
    const wanted = expectation.count ?? 1
    const seen = observed.filter(
      (call) =>
        call.port === expectation.port &&
        call.op === expectation.op &&
        (expectation.args === undefined || isSubset(expectation.args, call.args)),
    ).length
    if (seen !== wanted)
      problems.push(
        `${expectation.port}.${expectation.op}${expectation.args === undefined ? "" : ` ${JSON.stringify(expectation.args)}`} expected ${wanted} call(s), observed ${seen}`,
      )
  }
  return problems
}

// The closed list of port operations is the contract package's (slice P1a); it is passed in, never restated here. Every
// port and op a scenario names (expected, injected, given) must be in it, and a fault must be meaningful on its port.
export function portProblems(scenarios: readonly TableScenario[], ports: PortOperations): string[] {
  const isOp = (port: string, op: string): boolean => (ports[port] ?? []).includes(op)
  const faultProblems = (id: string, fault: Fault | undefined): string[] => [
    ...(fault === undefined ? [] : [fault]).flatMap((fault) => [
      ...(isOp(fault.port, fault.op)
        ? []
        : [`scenario ${id} injects ${fault.fault} on ${fault.port}.${fault.op}, which is not a port operation`]),
      ...((FAULT_PORTS[fault.fault] as readonly string[]).includes(fault.port)
        ? []
        : [
            `scenario ${id} injects ${fault.fault} on ${fault.port}; it means something only on ${FAULT_PORTS[fault.fault].join(", ")}`,
          ]),
    ]),
  ]
  return scenarios.flatMap((scenario) => [
    ...[...scenario.expect, ...(scenario.then ?? []).flatMap((step) => step.expect)]
      .filter((expectation) => !isOp(expectation.port, expectation.op))
      .map(
        (expectation) =>
          `scenario ${scenario.id} expects ${expectation.port}.${expectation.op}, which is not a port operation`,
      ),
    ...faultProblems(scenario.id, scenario.fault),
    ...(scenario.then ?? []).flatMap((step, index) => faultProblems(`${scenario.id} step ${index + 2}`, step.fault)),
    ...(scenario.given ?? [])
      .filter((given) => ports[given.port] === undefined)
      .map((given) => `scenario ${scenario.id} gives state to ${given.port}, which is not a port`),
  ])
}
