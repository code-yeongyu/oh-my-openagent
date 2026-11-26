import { parseSync } from "oxc-parser"

import noFlakeMasking from "./oxlint/no-flake-masking.ts"

// #15114: the ratchet pins each file's count of no-flake-masking findings, but a count cannot see a
// raised value: `test(name, fn, 60_000)` changed to `216_000` keeps the count at one. So the values of
// those findings are pinned too, in their own file beside the counts baseline (whose shape stays
// as it is). The findings are the rule's own reports, run over the same source, so a value is read
// for exactly the arguments the count is taken from.

export const FLAKE_MASKING = "omo-testing/no-flake-masking"

type Node = { readonly type: string; readonly start: number; readonly [key: string]: unknown }

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"

export type Kind = "timeout" | "retry"

// One finding: its kind, its line, and its value, or null when it is not a number the file states.
export type Finding = { readonly kind: Kind; readonly line: number; readonly value: number | null }

// What the values file pins per file: each kind's values from highest to lowest, and how many
// findings have no statically known value.
export type FileValues = {
  readonly timeout?: readonly number[]
  readonly retry?: readonly number[]
  readonly unresolved?: number
}
export type Values = Readonly<Record<string, FileValues>>

const visit = (node: unknown, enter: (node: Node) => void): void => {
  if (Array.isArray(node)) {
    for (const item of node) visit(item, enter)
    return
  }
  if (!isNode(node)) return
  enter(node)
  for (const [key, value] of Object.entries(node)) if (key !== "parent") visit(value, enter)
}

const numberOf = (node: unknown): number | null =>
  isNode(node) && node.type === "Literal" && typeof node["value"] === "number" ? node["value"] : null

// `const NAME = <number>` anywhere in the file. A name declared twice is ambiguous and resolves to
// nothing, so shadowing cannot stand in for a raise.
const numericConstants = (program: unknown): ReadonlyMap<string, number | null> => {
  const constants = new Map<string, number | null>()
  visit(program, (node) => {
    if (node.type !== "VariableDeclaration" || node["kind"] !== "const") return
    for (const declarator of Array.isArray(node["declarations"]) ? node["declarations"] : []) {
      if (!isNode(declarator)) continue
      const id = declarator["id"]
      if (!isNode(id) || id.type !== "Identifier") continue
      const name = String(id["name"])
      constants.set(name, constants.has(name) ? null : numberOf(declarator["init"]))
    }
  })
  return constants
}

const valueOf = (node: Node, constants: ReadonlyMap<string, number | null>): number | null => {
  const target = node.type === "Property" ? node["value"] : node
  if (!isNode(target)) return null
  if (target.type === "Identifier") return constants.get(String(target["name"])) ?? null
  return numberOf(target)
}

export const flakeMaskingFindings = (file: string, source: string): Finding[] => {
  const { program } = parseSync(file, source)
  const constants = numericConstants(program)
  const reported: { readonly node: Node; readonly messageId: string }[] = []
  const handlers = noFlakeMasking.create({
    report: (problem) => reported.push({ node: problem.node as Node, messageId: problem.messageId }),
  })
  visit(program, (node) => {
    if (node.type === "CallExpression") handlers.CallExpression(node)
    if (node.type === "Property") handlers.Property(node)
  })
  return reported.map(({ node, messageId }) => ({
    kind: messageId === "retry" ? "retry" : "timeout",
    line: source.slice(0, node.start).split("\n").length,
    value: valueOf(node, constants),
  }))
}

const highestFirst = (values: readonly number[]): number[] => values.toSorted((a, b) => b - a)

export const fileValues = (findings: readonly Finding[]): FileValues => {
  const of = (kind: Kind) =>
    highestFirst(
      findings.flatMap((finding) => (finding.kind === kind && finding.value !== null ? [finding.value] : [])),
    )
  const timeout = of("timeout")
  const retry = of("retry")
  const unresolved = findings.filter((finding) => finding.value === null).length
  return {
    ...(timeout.length > 0 ? { timeout } : {}),
    ...(retry.length > 0 ? { retry } : {}),
    ...(unresolved > 0 ? { unresolved } : {}),
  }
}

export type ValueChange = {
  readonly file: string
  readonly kind: Kind | "unresolved"
  readonly line: number | null
  readonly before: number
  readonly after: number
}

// Both sides are ordered from highest to lowest and compared place by place, so moving or reordering
// findings in a file changes nothing. A current value above the pinned one is a raise; an added
// finding is compared against nothing (0), so even a count edited in the same change cannot let it
// through unseen. A value below the pinned one, or a pinned value with no finding left, is a
// lowering: like a dropped count, it must be recorded in the same change, or the old, higher pin
// would let a later change raise the value back unseen.
export const compareValues = (
  pinned: Values,
  current: Readonly<Record<string, readonly Finding[]>>,
): { readonly raises: ValueChange[]; readonly lowerings: ValueChange[] } => {
  const raises: ValueChange[] = []
  const lowerings: ValueChange[] = []
  for (const file of [...new Set([...Object.keys(pinned), ...Object.keys(current)])].toSorted()) {
    const findings = current[file] ?? []
    for (const kind of ["timeout", "retry"] as const) {
      const before = pinned[file]?.[kind] ?? []
      const after = findings
        .filter((finding) => finding.kind === kind && finding.value !== null)
        .toSorted((a, b) => (b.value ?? 0) - (a.value ?? 0))
      for (let index = 0; index < Math.max(before.length, after.length); index++) {
        const was = before[index] ?? 0
        const now = after[index]?.value ?? 0
        const change = { file, kind, line: after[index]?.line ?? null, before: was, after: now }
        if (now > was) raises.push(change)
        if (now < was) lowerings.push(change)
      }
    }
    const unresolvedBefore = pinned[file]?.unresolved ?? 0
    const unresolvedAfter = findings.filter((finding) => finding.value === null).length
    const change = { file, kind: "unresolved" as const, line: null, before: unresolvedBefore, after: unresolvedAfter }
    if (unresolvedAfter > unresolvedBefore) raises.push(change)
    if (unresolvedAfter < unresolvedBefore) lowerings.push(change)
  }
  return { raises, lowerings }
}

export const describeValueChange = ({ file, kind, line, before, after }: ValueChange): string => {
  const direction = after > before ? "up" : "down"
  if (kind === "unresolved")
    return `${file}: ${FLAKE_MASKING} values that cannot be resolved statically went ${direction} from ${before} to ${after}`
  return `${file}${line === null ? "" : `:${line}`}: ${FLAKE_MASKING} ${kind} went ${direction} from ${before} to ${after}`
}
