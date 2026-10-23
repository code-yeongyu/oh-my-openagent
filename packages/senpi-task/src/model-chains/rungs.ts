import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import { excludedModelPattern } from "@oh-my-opencode/omo-config-core"

import { availableChainCandidates } from "../model-chain"
import type { ChainRung, ChainRungSource } from "./types"

export type DeclaredRung = {
  readonly model: string
  readonly source: ChainRungSource
  readonly providers?: readonly string[]
}

/**
 * A builtin rung as a concrete `provider/model`: the first listed provider the unfiltered registry
 * serves it through (the same provider walk the resolver makes), or the bare model with its
 * providers when none is logged in.
 */
export function builtinRungs(chain: readonly DelegateFallbackEntry[] | undefined, available: ReadonlySet<string>): readonly DeclaredRung[] {
  return (chain ?? []).map((rung): DeclaredRung => {
    const concrete = availableChainCandidates([rung], available)[0]
    return concrete === undefined
      ? { model: rung.model, source: "built-in", providers: rung.providers }
      : { model: concrete.model, source: "built-in" }
  })
}

/**
 * Each declared rung (first declaration of a model wins) with what the resolver did with it, then
 * any runtime model no declaration names, so the printed chain is always the resolver's own.
 */
export function classifyRungs(
  declared: readonly DeclaredRung[],
  runtime: readonly string[],
  available: ReadonlySet<string>,
  excludeModels: readonly string[] | undefined,
): readonly ChainRung[] {
  const seen = new Set<string>()
  const rungs: ChainRung[] = []
  for (const rung of declared) {
    if (seen.has(rung.model)) continue
    seen.add(rung.model)
    rungs.push(classify(rung, runtime, available, excludeModels))
  }
  for (const model of runtime) {
    if (!seen.has(model)) rungs.push(classify({ model, source: "built-in" }, runtime, available, excludeModels))
  }
  return rungs
}

function classify(
  rung: DeclaredRung,
  runtime: readonly string[],
  available: ReadonlySet<string>,
  excludeModels: readonly string[] | undefined,
): ChainRung {
  const base = { model: rung.model, source: rung.source }
  const position = runtime.indexOf(rung.model)
  if (position === 0) return { ...base, state: "primary" }
  if (position > 0) return { ...base, state: "fallback" }
  const excludedBy = excludedModelPattern(rung.model, excludeModels)
  if (excludedBy !== undefined) return { ...base, state: "excluded", excludedBy }
  if (rung.providers !== undefined || !available.has(rung.model)) {
    return { ...base, state: "no-login", ...(rung.providers === undefined ? {} : { providers: rung.providers }) }
  }
  return { ...base, state: "not-reached" }
}
