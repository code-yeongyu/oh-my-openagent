export type FallbackModelObject = {
  readonly model: string
  readonly variant?: string
  readonly reasoning?: string
  readonly reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  readonly temperature?: number
  readonly top_p?: number
  readonly max_tokens?: number
  readonly maxTokens?: number
  readonly provider_options?: Record<string, unknown>
  readonly thinking?: { readonly type: "enabled" | "disabled"; readonly budgetTokens?: number }
}
