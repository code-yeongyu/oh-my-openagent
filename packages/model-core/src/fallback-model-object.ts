export type FallbackModelObject = {
  readonly model: string
  readonly variant?: string
  readonly reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  readonly temperature?: number
  readonly top_p?: number
  readonly maxTokens?: number
  readonly thinking?: { readonly type: "enabled" | "disabled"; readonly budgetTokens?: number }
}
