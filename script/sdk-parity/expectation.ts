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

export type TableScenario = {
  /** `<row id>/<slug>`: stable, never reused for another behaviour. */
  readonly id: string
  readonly row: string
  readonly kind: "effect" | "refusal"
  readonly input: Readonly<Record<string, unknown>>
  /** The input is outside the call's input schema on purpose; such a scenario is a refusal with `invalid_arguments`. */
  readonly invalid?: true
  readonly refusal?: string
  readonly expect: readonly Expectation[]
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

// The closed list of port operations is the contract package's (slice P1a); it is passed in, never restated here.
export function portProblems(scenarios: readonly TableScenario[], ports: PortOperations): string[] {
  return scenarios.flatMap((scenario) =>
    scenario.expect
      .filter((expectation) => !(ports[expectation.port] ?? []).includes(expectation.op))
      .map(
        (expectation) =>
          `scenario ${scenario.id} expects ${expectation.port}.${expectation.op}, which is not a port operation`,
      ),
  )
}
