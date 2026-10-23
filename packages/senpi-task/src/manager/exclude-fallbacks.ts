import { isExcludedModel } from "@oh-my-opencode/omo-config-core"

import { splitModelDecorators } from "../senpi/explicit-pin"
import type { ManagedRunner, ManagedStartSpec } from "./types"

/**
 * A runner whose children never carry an excluded model in their fallback chain. A record persisted
 * before the model was added to `exclude_models` still lists it, and respawn and resume rebuild the
 * child's chain from that record, so the chain is filtered at the runner every launch goes through.
 */
export function withoutExcludedFallbacks(runner: ManagedRunner, patterns: readonly string[] | undefined): ManagedRunner {
  if (patterns === undefined || patterns.length === 0) return runner
  const filter = (spec: ManagedStartSpec): ManagedStartSpec => spec.fallbackModels === undefined
    ? spec
    : { ...spec, fallbackModels: spec.fallbackModels.filter((model) => !isExcludedModel(`${model.provider}/${model.model_id}`, patterns)) }
  const resume = runner.resume
  return {
    start: (spec) => runner.start(filter(spec)),
    ...(resume === undefined ? {} : { resume: (spec: ManagedStartSpec, sessionPath: string) => resume.call(runner, filter(spec), sessionPath) }),
  }
}

/** The same filter over `provider/model[:level]` selectors, for a process child's rebuilt chain. */
export function withoutExcludedSelectors(selectors: readonly string[], patterns: readonly string[] | undefined): readonly string[] {
  if (patterns === undefined || patterns.length === 0) return selectors
  return selectors.filter((selector) => !isExcludedModel(splitModelDecorators(selector).base, patterns))
}
