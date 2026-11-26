import type { GatedEntry } from "./contract-check"
import type { FieldSchema } from "./schema"

// Slice P1a-s (#14949): no call takes a principal, no credential-bearing answer can carry a secret, and the table P1a
// held for this slice is empty because every entry was typed or disposed of, never dropped.

type Node = FieldSchema & { readonly additionalProperties?: boolean; readonly anyOf?: readonly Node[] }

// A principal is fixed when a root is built (security design 3): a call input with one of these names would let a
// caller assert who it is.
const PRINCIPAL_NAMES = new Set(["principal", "sender", "caller", "caller_principal"])

// Names a secret could ride in. `UserCode` is not an answer: it is the person's own callback's argument (5.4).
const SECRET =
  /token|secret|password|passphrase|phrase|words|api_?key|refresh|private|recovery|user_?code|matching_?code|credential$/i

const walk = (node: Node | undefined, path: string, visit: (node: Node, path: string) => void): void => {
  if (node === undefined) return
  visit(node, path)
  for (const [name, child] of Object.entries(node.properties ?? {})) walk(child as Node, `${path}.${name}`, visit)
  for (const [i, variant] of (node.anyOf ?? []).entries()) walk(variant, `${path}|${i}`, visit)
  if (node.items !== undefined) walk(node.items as Node, `${path}[]`, visit)
}

export function principalInputProblems(calls: Readonly<Record<string, Node>>): string[] {
  const problems: string[] = []
  for (const [key, input] of Object.entries(calls))
    walk(input, key, (_node, path) => {
      const name = path.slice(path.lastIndexOf(".") + 1)
      if (path !== key && PRINCIPAL_NAMES.has(name))
        problems.push(`${path}: a call takes a principal; the principal is fixed when the root is built`)
    })
  return problems
}

const fieldsOf = (node: Node): string[] => {
  const out: string[] = []
  walk(node, "", (_inner, path) => {
    if (path !== "") out.push(path.replace(/\|\d+/g, "").slice(1))
  })
  return [...new Set(out)].toSorted()
}

export function custodyResultProblems(
  results: Readonly<Record<string, Node>>,
  expected: Readonly<Record<string, readonly string[]>>,
): string[] {
  const problems: string[] = []
  for (const [call, schema] of Object.entries(results)) {
    walk(schema, call, (node, path) => {
      const name = path.slice(path.lastIndexOf(".") + 1).replace(/\|\d+$/, "")
      if (path !== call && SECRET.test(name)) problems.push(`${path}: a field a secret could ride in`)
      if (node.properties !== undefined && node.additionalProperties !== false)
        problems.push(`${path}: an answer object is closed (additionalProperties false)`)
    })
    const have = fieldsOf(schema)
    const want = [...(expected[call] ?? [])].toSorted()
    if (JSON.stringify(have) !== JSON.stringify(want))
      problems.push(`${call}: answers fields ${have.join(", ")}; the non-secret set is ${want.join(", ")}`)
  }
  for (const call of Object.keys(expected)) if (results[call] === undefined) problems.push(`${call}: no answer schema`)
  return problems
}

/** How each entry P1a held left the table: typed by this slice, or a stated disposition. */
export type Taken = { readonly entry: string; readonly typed: boolean; readonly disposition?: string }

export function gatedProblems(
  gated: readonly GatedEntry[],
  held: readonly Taken[],
  typed: (entry: string) => boolean,
): string[] {
  const problems: string[] = []
  for (const entry of gated)
    problems.push(
      `GATED ${entry.row}${entry.field === undefined ? "" : `.${entry.field}`}: slice P1a-s typed every held entry`,
    )
  for (const take of held) {
    if (take.typed && !typed(take.entry)) problems.push(`${take.entry}: left GATED but is not typed`)
    if (!take.typed && (take.disposition ?? "").trim() === "") problems.push(`${take.entry}: untyped, say why`)
    if (!take.typed && typed(take.entry)) problems.push(`${take.entry}: typed, so it has no disposition`)
  }
  return problems
}
