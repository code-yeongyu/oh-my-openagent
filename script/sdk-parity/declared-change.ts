import type { BaselineEntry } from "./baseline"
import { sha256 } from "./baseline"
import type { Outcome } from "./scenario-run"
import type { Scenario } from "./scenarios"
import type { Row } from "./schema"
import { type DiscoveredTool, schemaDifferences } from "./tool-check"

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

// A declaration is a line that starts with the marker, anywhere in the body (a code fence included); the marker is
// matched without regard to case, as the Unchanged line is. The scenario id and the kind are matched exactly.
const DECLARATION_LINE = /^SDK-Parity-Changed:(.*)$/gim

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

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

/** The input field's literal variants, as `enum` values or `anyOf` consts (the registry's two shapes). */
function fieldVariants(tool: DiscoveredTool, field: string): readonly string[] | undefined {
  const schema = asRecord(asRecord(tool.parameters.properties)?.[field])
  if (schema === undefined) return undefined
  const listed = asArray(schema["enum"]).filter((value): value is string => typeof value === "string")
  if (listed.length > 0) return listed
  const variants = asArray(schema["anyOf"])
    .map((variant) => asRecord(variant)?.["const"])
    .filter((value): value is string => typeof value === "string")
  return variants.length > 0 ? variants : undefined
}

/** The registered variants are the base's, in order, with new ones appended (a widening, never a reorder). */
const widensInOrder = (base: readonly string[], head: readonly string[]): boolean =>
  head.length > base.length && base.every((value, index) => head[index] === value)

/** `<tool>.<field>`: the tool a declaration names and the field it widens or adds. */
function namedField(declaration: Declaration): { readonly tool: string; readonly field: string } | undefined {
  const arg = declaration.args[0]
  const split = arg?.lastIndexOf(".") ?? -1
  if (arg === undefined || split <= 0 || split === arg.length - 1) return undefined
  return { tool: arg.slice(0, split), field: arg.slice(split + 1) }
}

const KINDS: Readonly<Record<string, { readonly args: number; readonly check: KindCheck }>> = {
  // An additive input change: the named tool field's variants are the base's plus new ones appended, nothing else in
  // that tool's schema moved, and the scenario's outcome differs only by the new variants appearing in it (#15345).
  "input-enum-widened": {
    args: 1,
    check: (declaration, scenario, before, after, context) => {
      const named = namedField(declaration)
      if (named === undefined) return "its argument must be <tool>.<field>"
      const row = context.rows.head.find((entry) => entry.id === scenario.capability)
      if (row === undefined || !row.tool.some((entry) => entry.name === named.tool))
        return `${named.tool} is not a tool of ${scenario.capability}`
      const baseTool = context.tools.base.find((tool) => tool.name === named.tool)
      const headTool = context.tools.head.find((tool) => tool.name === named.tool)
      if (baseTool === undefined || headTool === undefined)
        return `the tool ${named.tool} is not discovered on both trees`
      const baseVariants = fieldVariants(baseTool, named.field)
      const headVariants = fieldVariants(headTool, named.field)
      if (baseVariants === undefined || headVariants === undefined)
        return `${named.tool}.${named.field} is not a literal input field on both trees`
      if (!widensInOrder(baseVariants, headVariants))
        return `${named.tool}.${named.field} does not widen in order (${baseVariants.length} to ${headVariants.length} variants)`
      const moved = schemaDifferences(baseTool.parameters, headTool.parameters, named.tool)
      const allowed = [
        `${named.tool}.${named.field}: ${baseVariants.length} variants in the tool and ${headVariants.length} in the SDK`,
        `${named.tool}.${named.field}: enum is ${JSON.stringify(baseVariants)} in the tool and ${JSON.stringify(headVariants)} in the SDK`,
      ]
      if (moved.length !== 1 || !allowed.includes(moved[0] ?? ""))
        return `the tool's schema differs outside the widened field (${moved.join("; ") || "nothing moved"})`
      const printed = JSON.stringify(after)
      const baseList = baseVariants.join(", ")
      const headList = headVariants.join(", ")
      return printed.replace(headList, baseList) === JSON.stringify(before) && printed.includes(headList)
        ? undefined
        : "the outcomes differ outside the newly listed variants"
    },
  },
  // An additive result field: the head's result carries the named field and is byte-equal to the base once it is
  // removed, and the base result does not carry it (#15345).
  "result-field-added": {
    args: 1,
    check: (declaration, scenario, before, after, context) => {
      const named = namedField(declaration)
      if (named === undefined) return "its argument must be <tool>.<field>"
      const row = context.rows.head.find((entry) => entry.id === scenario.capability)
      if (row === undefined || !row.tool.some((entry) => entry.name === named.tool))
        return `${named.tool} is not a tool of ${scenario.capability}`
      if (!answers(before) || !answers(after)) return "the kind result-field-added needs both trees to answer"
      const beforeResult = resultOf(before)
      const afterResult = resultOf(after)
      if (beforeResult === undefined || afterResult === undefined) return "neither tree answers with a result object"
      if (Object.hasOwn(beforeResult, named.field)) return `the base result already carries ${named.field}`
      if (!Object.hasOwn(afterResult, named.field)) return `the head result does not carry ${named.field}`
      const rest = (result: Record<string, unknown>) => {
        const { [named.field]: _added, ...kept } = result
        return kept
      }
      return without(after, rest) === without(before, (result) => result)
        ? undefined
        : "the outcomes differ outside the added result field"
    },
  },
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
  readonly baseHash: string
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
    baseHash: sha256(JSON.stringify(before)).slice(0, 24),
  }
}

/** The digest's entry for a declared change: its scenario, the provider, kind, arguments and its head outcome's hash. */
// The detail binds both outcomes: a base that moves under an unchanged head changes the mark, so a signature given over
// one 'before' does not carry to another.
const declaredDetail = (change: DeclaredChange): string =>
  `${[change.kind, ...change.args].join(" ")}@${change.hash}/${change.baseHash}`

// What a provider answers for one scenario: it exempts it (optionally with a detail the digest binds; the gate writes the
// scenario and the provider's name itself), it states the problem that keeps it failing, or it has nothing to say.
export type ProviderAnswer =
  { readonly detail?: string; readonly change?: DeclaredChange } | { readonly problem: string } | undefined

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
  return typeof judged === "string" ? { problem: judged } : { detail: declaredDetail(judged), change: judged }
}

const BOUND = 600
const MASKS = ["<sandbox>", "<tree>", "<tmp>"]

/** One side's outcome as the check prints it: bounded, with each masked span counted so the signer sees what was hidden. */
function printedOutcome(outcome: Outcome): string {
  const text = JSON.stringify(outcome)
  const masked = MASKS.map((mask) => [mask, text.split(mask).length - 1] as const)
    .filter(([, count]) => count > 0)
    .map(([mask, count]) => `${mask} x${count}`)
  const shown = text.length > BOUND ? `${text.slice(0, BOUND)}... (${text.length} chars)` : text
  return masked.length === 0 ? shown : `${shown} [masked: ${masked.join(", ")}]`
}

const WINDOW = 120

/**
 * Both sides of a declared change as the check prints them: the head of each, then a window around the first offset
 * where they differ, so a change past the printed head is still shown to the signer.
 */
export function printedPair(before: Outcome, after: Outcome): string[] {
  const [a, b] = [JSON.stringify(before), JSON.stringify(after)]
  let at = 0
  while (at < a.length && at < b.length && a[at] === b[at]) at++
  const lines = [`  merge base: ${printedOutcome(before)}`, `  head:       ${printedOutcome(after)}`]
  if (a === b) return lines
  const window = (text: string) =>
    `${at > WINDOW ? "..." : ""}${text.slice(Math.max(0, at - WINDOW), at + WINDOW)}${at + WINDOW < text.length ? "..." : ""}`
  const hidden = a.slice(0, BOUND) === b.slice(0, BOUND)
  return [
    ...lines,
    `  first difference at offset ${at}${hidden ? "; the printed heads above are equal, the outcomes differ after them" : ""}:`,
    `  merge base: ${window(a)}`,
    `  head:       ${window(b)}`,
  ]
}

/** The merge base's own scenario table, loaded from its file: a file that exists and does not load is an error. */
export async function loadBaseScenarioTable(file: string): Promise<readonly Scenario[]> {
  const module = (await import(file)) as { readonly SCENARIOS?: unknown }
  if (!Array.isArray(module.SCENARIOS)) throw new Error(`${file} exports no SCENARIOS array`)
  return module.SCENARIOS as readonly Scenario[]
}
