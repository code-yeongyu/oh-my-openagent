export type FallbackModelObject = {
  readonly model: string
  readonly variant?: string
  readonly reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  readonly temperature?: number
  readonly top_p?: number
  readonly maxTokens?: number
  readonly thinking?: {
    readonly type: "enabled" | "disabled" | "adaptive"
    readonly budgetTokens?: number
    readonly display?: "summarized" | "omitted"
  }
}
