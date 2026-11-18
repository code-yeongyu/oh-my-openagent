import { METHODS, type MethodName, ONESHOT } from "./engine-schema.generated.ts"

type MethodRow = (typeof METHODS)[number]

const byName: ReadonlyMap<string, MethodRow> = new Map(METHODS.map((row) => [row.name, row]))
const aliases: ReadonlyMap<string, string> = new Map(Object.entries(ONESHOT.aliases))

/** The method a one-shot call names: the exact name, an alias, or the name after the prefix. */
export function resolveOneshot(name: string): MethodName | undefined {
  const exact = byName.get(name)
  if (exact !== undefined) return exact.name
  const alias = aliases.get(name)
  if (alias !== undefined) return byName.get(alias)?.name
  return name.startsWith(ONESHOT.prefix) ? byName.get(name.slice(ONESHOT.prefix.length))?.name : undefined
}

/** One hop of a `tool.computer({action:"call", chain})` call chain. */
export interface CallStep {
  readonly method: string
}

export type ChainVerdict =
  | { readonly kind: "tier"; readonly tier: "read" | "exec" }
  | {
      readonly kind: "refused"
      readonly reason: "empty_chain" | "unknown_method" | "host_only" | "test_only"
      readonly method?: string
    }

/**
 * The permission tier of a call chain: `exec` when any hop is an exec method, else `read`.
 * A chain that names an unknown, host-only or test-only method is refused before any hop runs.
 */
export function classifyCallChain(chain: readonly CallStep[]): ChainVerdict {
  if (chain.length === 0) return { kind: "refused", reason: "empty_chain" }
  let tier: "read" | "exec" = "read"
  for (const step of chain) {
    const row = byName.get(step.method)
    if (row === undefined) return { kind: "refused", reason: "unknown_method", method: step.method }
    if (row.exposure === "testOnly") return { kind: "refused", reason: "test_only", method: step.method }
    if (row.exposure !== "public") return { kind: "refused", reason: "host_only", method: step.method }
    if (row.effect === "exec") tier = "exec"
  }
  return { kind: "tier", tier }
}
