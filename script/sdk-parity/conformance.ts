import {
  type Expectation,
  expectationProblems,
  isSubsetOf,
  type ObservedCall,
  type PortOperations,
} from "./expectation"
import type { Row } from "./schema"

// Design 7.2, "a row's call is real" (reviews 6061267823 H3, 6061624223 H1, 6061874518 H1/H2; amendment 5): a row is built
// only by typed evidence from a run at the head. A record passes when its kind is the one the row's split gives it, its
// observed port calls match the stated expectations, no EFFECT operation happened that the scenario did not state, and
// its answer (when stated) matches. Every optional input needs a pair of passing records that differ in it alone, and a
// row that takes a thread address needs a passing effect on each target.

export type EffectEvidence = {
  readonly scenario: string
  readonly row: string
  readonly kind: "effect" | "refusal"
  readonly member: string
  readonly input: Readonly<Record<string, unknown>>
  readonly expect: readonly Expectation[]
  readonly target?: "this_device" | "other_device"
  readonly observed: readonly ObservedCall[]
  readonly refusal?: string
  readonly refusalFrom?: "root" | "value"
  readonly code?: string
  /** Where a refusal code was read: the root failure, or the error field of the value the call answered. */
  readonly codeSource?: "root" | "value"
  readonly answer?: Readonly<Record<string, unknown>>
  readonly answered?: unknown
  readonly threw?: string
  /** The `then` calls, run in order on the state the call before each left; each must pass for the scenario to pass. */
  readonly steps?: readonly EffectEvidence[]
}

/** What the checks need beyond the rows: the effect operations per port (slice P1a's PORT_EFFECTS, every port named, an
 * empty list for a port with no effects) and the table's inert fields. P0 ships no SDK call and no run, so it passes none. */
export type ConformanceContext = {
  readonly effects: PortOperations
  readonly inert?: ReadonlySet<string>
}

// Design 7.3: the three host-local operations act on the session host of the calling device only (closed list in the
// schema); on another device they answer a refusal, which is what their other_device scenario states.
const isHostLocal = (row: Row): boolean => row.addressScope === "this_device"

const stated = (record: EffectEvidence, call: ObservedCall): boolean =>
  record.expect.some(
    (expectation) =>
      expectation.port === call.port &&
      expectation.op === call.op &&
      (expectation.args === undefined || isSubsetOf(expectation.args, call.args)),
  )

function recordProblems(row: Row, record: EffectEvidence, context: ConformanceContext): string[] {
  const listed = row.scenarios.effect.includes(record.scenario) ? "effect" : "refusal"
  if (record.kind !== listed)
    return [
      `row ${row.id}: scenario ${record.scenario} is a ${record.kind} scenario but the row lists it under ${listed}`,
    ]
  return [record, ...(record.steps ?? [])].flatMap((call) => callProblems(row, call, context))
}

function callProblems(row: Row, record: EffectEvidence, context: ConformanceContext): string[] {
  const where = `row ${row.id}: scenario ${record.scenario}`
  if (record.code === "not_implemented") return [`${where} answered not_implemented; ${row.sdk} is a stub, build it`]
  if (record.threw !== undefined) return [`${where} threw ${record.threw}`]
  if (record.row !== row.id || record.member !== row.sdk)
    return [`${where} ran ${record.member} for ${record.row}, not ${row.sdk}`]
  if (record.kind === "refusal" && record.code !== record.refusal)
    return [`${where} answered ${record.code ?? "success"}, not the refusal ${record.refusal ?? "(none named)"}`]
  if (record.kind === "refusal" && record.codeSource !== (record.refusalFrom ?? "root"))
    return [
      `${where} read its refusal from the ${record.codeSource ?? "nowhere"}, not the ${record.refusalFrom ?? "root"} it states`,
    ]
  if (record.kind === "effect" && record.code !== undefined)
    return [`${where} answered ${record.code} where an effect was expected`]
  // Design 4.4: success is the root contract's discriminator, `kind: "ok"`, not the absence of a code (review 6062344773).
  if (record.kind === "effect" && Reflect.get(Object(record.answered), "kind") !== "ok")
    return [`${where} answered ${JSON.stringify(record.answered)}, not a successful result (kind "ok")`]
  // A PURE row (closed list in the schema) touches nothing: its answer builds it only when the trace is EMPTY, reads
  // included, and an answer is stated. Every other effect scenario must state a port effect.
  if (record.kind === "effect" && row.pure === true) {
    if (record.observed.length > 0)
      return [
        `${where}: a pure call touched ${record.observed.map((call) => `${call.port}.${call.op}`).join(", ")}; it must touch nothing`,
      ]
    if (record.answer === undefined) return [`${where}: a pure call is proven by its answer; state it`]
  } else if (record.kind === "effect" && record.expect.every((expectation) => (expectation.count ?? 1) === 0))
    return [`${where} states no port effect; an answer alone does not build a row`]
  const problems = expectationProblems(record.expect, record.observed).map((problem) => `${where}: ${problem}`)
  for (const call of record.observed)
    if (context.effects[call.port] === undefined)
      problems.push(
        `${where}: port ${call.port} has no effect classification; the effect table passed in must name every port`,
      )
    else if ((context.effects[call.port] ?? []).includes(call.op) && !stated(record, call))
      problems.push(
        `${where}: effect ${call.port}.${call.op} ${JSON.stringify(call.args)} happened but the scenario does not state it`,
      )
  if (record.answer !== undefined && !isSubsetOf(record.answer, record.answered))
    problems.push(
      `${where}: answered ${JSON.stringify(record.answered)}, not the expected ${JSON.stringify(record.answer)}`,
    )
  return problems
}

// The effect a scenario states, compared with the matcher's own semantics (review 6062172318 M3): the fakes' stimulus
// (`result`) is no part of it, order does not matter, an absent count is 1, and argument objects compare by content.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([key, inner]) => [key, canonical(inner)]),
        )
      : value
const effectOf = (record: EffectEvidence): string =>
  JSON.stringify(
    [record, ...(record.steps ?? [])].map((call) =>
      call.expect
        .map(({ port, op, args, count }) =>
          JSON.stringify(canonical({ port, op, args: args ?? {}, count: count ?? 1 })),
        )
        .toSorted(),
    ),
  )

// Coverage is computed, never declared: an optional input is covered by two passing records of the row whose inputs
// differ in that field alone and that differ in kind or stated effect. Required inputs and inert fields are exempt.
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
              (a.kind !== b.kind || effectOf(a) !== effectOf(b)),
          ),
        ),
    )
    .map((field) => `row ${row.id}: input ${field} has no pair of passing scenarios that differ in it alone; add one`)
}

function addressProblems(row: Row, passing: readonly EffectEvidence[]): string[] {
  if (!Object.hasOwn(row.input.properties, "thread")) return []
  const passes = (kind: EffectEvidence["kind"], target: "this_device" | "other_device"): boolean =>
    passing.some((record) => record.kind === kind && record.target === target)
  const needed: ReadonlyArray<readonly [EffectEvidence["kind"], "this_device" | "other_device"]> = isHostLocal(row)
    ? [
        ["effect", "this_device"],
        ["refusal", "other_device"],
      ]
    : [
        ["effect", "this_device"],
        ["effect", "other_device"],
      ]
  return needed
    .filter(([kind, target]) => !passes(kind, target))
    .map(([kind, target]) => `row ${row.id}: no passing ${kind} scenario addresses a thread on ${target}; add one`)
}

function evidenceProblems(row: Row, evidence: readonly EffectEvidence[], context: ConformanceContext): string[] {
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
    const found = recordProblems(row, record, context)
    problems.push(...found)
    if (found.length === 0) passing.push(record)
  }
  if (!passing.some((record) => record.kind === "effect") && row.scenarios.effect.length > 0)
    problems.push(`row ${row.id} has no passing effect scenario`)
  if (row.scenarios.effect.length > 0) problems.push(...coverageProblems(row, passing, context.inert ?? new Set()))
  problems.push(...addressProblems(row, passing))
  return problems
}

export const isBuilt = (row: Row, evidence: readonly EffectEvidence[], context: ConformanceContext): boolean =>
  row.today === "yes" && evidenceProblems(row, evidence, context).length === 0

// Every capability row not in unresolved.json counts as built and must carry that evidence.
export function conformanceProblems(
  rows: readonly Row[],
  unresolved: ReadonlySet<string>,
  evidence: readonly EffectEvidence[],
  context: ConformanceContext,
): string[] {
  return rows
    .filter((row) => row.kind === "capability" && !unresolved.has(row.id))
    .flatMap((row) => evidenceProblems(row, evidence, context))
}
