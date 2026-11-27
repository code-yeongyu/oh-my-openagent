import type { BaselineEntry } from "./baseline"
import { sha256 } from "./baseline"
import type { Outcome } from "./scenario-run"
import type { Scenario } from "./scenarios"
import type { Row } from "./schema"
import type { DiscoveredTool } from "./tool-check"

// The declared form of a scenario whose outcome a pull request changes on purpose (#15199). The pull request body names
// each such scenario on its own line, `SDK-Parity-Changed: <scenario-id> <kind>[ <arg> ...]`; nothing is stored in the
// tree. A declaration exempts only its own scenario from the rule that an outcome difference under an unresolved entry
// fails, and only when the kind's check holds on the two normalized outcomes.

export type Declaration = { readonly scenario: string; readonly kind: string; readonly args: readonly string[] }

export type KindContext = {
  readonly outcomes: {
    readonly base: Readonly<Record<string, Outcome>>
    readonly head: Readonly<Record<string, Outcome>>
  }
  readonly rows: { readonly base: readonly Row[] | undefined; readonly head: readonly Row[] }
  readonly unresolved: { readonly base: readonly BaselineEntry[] | undefined; readonly head: readonly BaselineEntry[] }
  readonly tools: { readonly base: readonly DiscoveredTool[]; readonly head: readonly DiscoveredTool[] }
  readonly ahead: ReadonlyMap<string, unknown>
}

// A kind returns one problem, or undefined when the two outcomes satisfy it.
export type KindCheck = (
  declaration: Declaration,
  scenario: Scenario,
  before: Outcome,
  after: Outcome,
  context: KindContext,
) => string | undefined

const DECLARATION_LINE = /^SDK-Parity-Changed:(.*)$/gm

const resultOf = (outcome: Outcome): Record<string, unknown> | undefined => {
  const result =
    (outcome as { readonly result?: unknown; readonly answer?: unknown }).result ??
    (outcome as { readonly answer?: unknown }).answer
  return typeof result === "object" && result !== null && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : undefined
}
const refuses = (outcome: Outcome): boolean => {
  const result = resultOf(outcome)
  return result?.["kind"] === "error" && typeof result["error"] === "object" && result["error"] !== null
}
const answers = (outcome: Outcome): boolean => {
  const result = resultOf(outcome)
  return result !== undefined && typeof result["kind"] === "string" && result["kind"] !== "error"
}

// The outcome with one part of its result removed, everything else kept, so "byte-equal apart from that part" is a
// plain comparison of the two remainders.
const without = (outcome: Outcome, strip: (result: Record<string, unknown>) => Record<string, unknown>): string => {
  const key = "result" in outcome ? "result" : "answer"
  const result = resultOf(outcome)
  return JSON.stringify(result === undefined ? outcome : { ...outcome, [key]: strip(result) })
}

const KINDS: Readonly<Record<string, { readonly args: number; readonly check: KindCheck }>> = {
  // Both trees answer, with the same result kind, and the outcomes are byte-equal once the answer's value is removed.
  answer: {
    args: 0,
    check: (_declaration, _scenario, before, after) => {
      if (!answers(before) || !answers(after)) return "the kind answer needs both trees to answer"
      if (resultOf(before)?.["kind"] !== resultOf(after)?.["kind"]) return "the two answers have different result kinds"
      const rest = (result: Record<string, unknown>) => {
        const { value: _value, ...kept } = result
        return kept
      }
      return without(before, rest) === without(after, rest)
        ? undefined
        : "the outcomes differ outside the answer's value"
    },
  },
  // Both trees refuse with an error object, and the outcomes are byte-equal apart from error.next_action and
  // error.details. A refusal the host throws before the call runs has no result, so this kind cannot reach it.
  refusal: {
    args: 0,
    check: (_declaration, _scenario, before, after) => {
      if (!refuses(before) || !refuses(after)) return "the kind refusal needs both trees to refuse"
      const rest = (result: Record<string, unknown>) => {
        const { next_action: _next, details: _details, ...error } = result["error"] as Record<string, unknown>
        return { ...result, error }
      }
      const [a, b] = [before, after].map((outcome) => resultOf(outcome)?.["error"] as Record<string, unknown>)
      if (a?.["code"] === b?.["code"] && a?.["message"] !== b?.["message"])
        return "its message changes under the same code, which no kind admits; its route is the slice that clears the row"
      return without(before, rest) === without(after, rest)
        ? undefined
        : "the outcomes differ outside error.next_action and error.details"
    },
  },
}

export type DeclaredChange = {
  readonly scenario: string
  readonly capability: string
  readonly kind: string
  readonly args: readonly string[]
  readonly before: Outcome
  readonly after: Outcome
  readonly hash: string
}

/** Parses the body's declarations; a line that does not parse is a problem, never skipped. */
export function parseDeclarations(body: string): { declarations: Declaration[]; problems: string[] } {
  const declarations: Declaration[] = []
  const problems: string[] = []
  for (const match of body.matchAll(DECLARATION_LINE)) {
    const text = (match[1] ?? "").trim()
    const [scenario, kind, ...args] = text.split(" ")
    if (scenario === undefined || scenario === "" || kind === undefined) {
      problems.push(`SDK-Parity-Changed: '${text}' names no scenario and kind`)
      continue
    }
    const known = KINDS[kind]
    if (known === undefined) {
      problems.push(`SDK-Parity-Changed: ${scenario}: the kind ${kind} is not one of ${Object.keys(KINDS).join(", ")}`)
      continue
    }
    if (args.length !== known.args) {
      problems.push(`SDK-Parity-Changed: ${scenario} ${kind} takes ${known.args} argument(s), not ${args.length}`)
      continue
    }
    if (declarations.some((declaration) => declaration.scenario === scenario)) {
      problems.push(`SDK-Parity-Changed: ${scenario} is declared twice`)
      continue
    }
    declarations.push({ scenario, kind, args })
  }
  return { declarations, problems }
}

/**
 * Judges one declared scenario whose two outcomes the gate has. It answers the declared change, or the problem that
 * keeps the scenario under the failing rule.
 */
function judgeDeclaration(
  declaration: Declaration,
  scenario: Scenario,
  before: Outcome,
  after: Outcome,
  context: KindContext,
): DeclaredChange | string {
  const where = `SDK-Parity-Changed: ${declaration.scenario}`
  if (JSON.stringify(before) === JSON.stringify(after))
    return `${where}: its outcome is equal on the merge base and the head; there is nothing to declare`
  if (refuses(before) !== refuses(after))
    return `${where}: it answers on one tree and refuses on the other, which is not admitted by a declaration; its route is the authority matrix`
  const problem = KINDS[declaration.kind]?.check(declaration, scenario, before, after, context)
  if (problem !== undefined) return `${where} ${declaration.kind}: ${problem}`
  return {
    scenario: declaration.scenario,
    capability: scenario.capability,
    kind: declaration.kind,
    args: declaration.args,
    before,
    after,
    hash: sha256(JSON.stringify(after)).slice(0, 24),
  }
}

/** The digest's entry for a declared change: its scenario, the provider, kind, arguments and its head outcome's hash. */
const declaredMark = (change: DeclaredChange): string =>
  `${change.scenario}#exempt=declared:${[change.kind, ...change.args].join(" ")}@${change.hash}`

// What a provider answers for one scenario: it exempts it (with the mark the digest binds), it states the problem that
// keeps it failing, or it has nothing to say.
export type ProviderAnswer =
  { readonly exempt: string; readonly change?: DeclaredChange } | { readonly problem: string } | undefined

export type ExemptionProvider = (
  scenario: Scenario,
  before: Outcome,
  after: Outcome,
  context: KindContext & { readonly declarations: ReadonlyMap<string, Declaration> },
) => ProviderAnswer

// The provider 'declared': a scenario the body names on an SDK-Parity-Changed line, held by its kind.
export const declaredProvider: ExemptionProvider = (scenario, before, after, context) => {
  const declaration = context.declarations.get(scenario.id)
  if (declaration === undefined) return undefined
  const judged = judgeDeclaration(declaration, scenario, before, after, context)
  return typeof judged === "string" ? { problem: judged } : { exempt: declaredMark(judged), change: judged }
}

const BOUND = 600
const MASKS = ["<sandbox>", "<tree>", "<tmp>"]

/** One side's outcome as the check prints it: bounded, with each masked span counted so the signer sees what was hidden. */
export function printedOutcome(outcome: Outcome): string {
  const text = JSON.stringify(outcome)
  const masked = MASKS.map((mask) => [mask, text.split(mask).length - 1] as const)
    .filter(([, count]) => count > 0)
    .map(([mask, count]) => `${mask} x${count}`)
  const shown = text.length > BOUND ? `${text.slice(0, BOUND)}... (${text.length} chars)` : text
  return masked.length === 0 ? shown : `${shown} [masked: ${masked.join(", ")}]`
}
