// THE maintained OpenAI-only model catalog, and the only definition of it. Both editions read this
// record: the OpenCode installer derives its config-generation overrides from it in
// packages/omo-opencode/src/cli/openai-only-model-catalog.ts, and OMO Native compiles it into
// runtime category/agent resolution against the authenticated live model registry. It lives here so
// senpi-task can consume it without pulling in the OpenCode adapter. Never re-declare these ids
// elsewhere - a second copy drifts silently and self-consistent tests cannot detect it.
//
// `architect` is deliberately absent: its availability is governed by its required-model gate and it
// must never be synthesized from an unrelated model.

export type OpenAiOnlyRecommendation = {
  readonly modelId: string
  readonly variant?: string
}

export const OPENAI_ONLY_CATEGORY_RECOMMENDATIONS: Readonly<Record<string, OpenAiOnlyRecommendation>> = {
  artistry: { modelId: "gpt-5.6-sol", variant: "xhigh" },
  quick: { modelId: "gpt-5.6-luna-fast" },
  "visual-engineering": { modelId: "gpt-5.6-sol", variant: "high" },
  writing: { modelId: "gpt-5.6-sol", variant: "medium" },
}

export const OPENAI_ONLY_AGENT_RECOMMENDATIONS: Readonly<Record<string, OpenAiOnlyRecommendation>> = {
  explore: { modelId: "gpt-5.6-luna-fast", variant: "low" },
  librarian: { modelId: "gpt-5.6-luna-fast", variant: "low" },
}

// Every upstream model id the maintained catalogs can recommend. An explicitly mapped provider alias
// counts as openai-identified only when its upstream id is in this set, so an arbitrary
// OpenAI-compatible endpoint serving unrelated models is never mistaken for the OpenAI inventory.
export const OPENAI_ONLY_RECOMMENDED_MODEL_IDS: ReadonlySet<string> = new Set([
  ...Object.values(OPENAI_ONLY_CATEGORY_RECOMMENDATIONS).map((entry) => entry.modelId),
  ...Object.values(OPENAI_ONLY_AGENT_RECOMMENDATIONS).map((entry) => entry.modelId),
])
