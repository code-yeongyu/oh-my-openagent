import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { DEFAULT_CATEGORIES } from "../category/builtins"
import { CATEGORY_FALLBACK_CHAINS } from "../category/fallback-chains"
import { resolveCategory } from "../category/resolver"
import type { CategoryResolutionResult, SenpiModelPort, SenpiModelRegistryPort } from "../category/types"
import { categoryModelCandidates } from "../category/user-candidates"
import { builtinRungs, classifyRungs, type DeclaredRung } from "./rungs"
import type { ModelChainEntry } from "./types"

function own<TValue>(record: Readonly<Record<string, TValue>> | undefined, key: string): TValue | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined
}

export function categoryRuntimeChain<TModel extends SenpiModelPort>(result: CategoryResolutionResult<TModel>): readonly string[] {
  if (result.kind !== "resolved") return []
  return [`${result.spec.provider}/${result.spec.modelId}`, ...(result.spec.fallback_models ?? []).map((model) => model.display)]
}

function unavailableReason<TModel extends SenpiModelPort>(result: CategoryResolutionResult<TModel>): string | undefined {
  switch (result.kind) {
    case "resolved":
      return undefined
    case "disabled":
      return result.reason
    case "not_found":
      return `no category named "${result.category}"`
    case "model_unavailable":
      if (result.missing_providers !== undefined && result.missing_providers.length > 0) {
        return `no rung is usable; connect one of ${result.missing_providers.join(", ")}`
      }
      return result.attemptedModel === undefined ? "no rung is usable" : `${result.attemptedModel} is not usable`
  }
}

/**
 * One category as a spawn sees it: `resolveCategory` supplies the runtime chain, and the declared
 * rungs (omo.json model, models[] or fallback_models, the builtin default, then the builtin chain)
 * are classified against it.
 */
export function describeCategoryChain<TModel extends SenpiModelPort>(
  name: string,
  config: OmoConfig,
  registry: SenpiModelRegistryPort<TModel>,
  available: ReadonlySet<string>,
): ModelChainEntry {
  const result = resolveCategory(name, config, registry)
  const userConfig = own(config.categories, name)
  const userModels = new Set(userConfig === undefined ? [] : categoryModelCandidates(userConfig).map((candidate) => candidate.model))
  const chain = own(CATEGORY_FALLBACK_CHAINS, name)
  // The builtin default model is the chain's own head rung; listing it twice would read as two rungs.
  const chainModelIds = new Set((chain ?? []).map((rung) => rung.model))
  const declared: readonly DeclaredRung[] = [
    ...categoryModelCandidates({ ...own(DEFAULT_CATEGORIES, name), ...userConfig }).flatMap((candidate): readonly DeclaredRung[] => {
      if (userModels.has(candidate.model)) return [{ model: candidate.model, source: "omo.json" }]
      return chainModelIds.has(candidate.model.slice(candidate.model.indexOf("/") + 1)) ? [] : [{ model: candidate.model, source: "built-in" }]
    }),
    ...builtinRungs(chain, available),
  ]
  const runtime = categoryRuntimeChain(result)
  const reason = unavailableReason(result)
  return {
    kind: "category",
    name,
    status: result.kind === "resolved" ? "resolved" : result.kind === "disabled" ? "disabled" : "unavailable",
    ...(runtime[0] === undefined ? {} : { primary: runtime[0] }),
    runtime,
    rungs: classifyRungs(declared, runtime, available, config.exclude_models),
    ...(reason === undefined ? {} : { reason }),
  }
}
