export type ModelCapability =
	| "strong-reasoning"
	| "fast-inference"
	| "code-generation"
	| "multimodal"
	| "long-context"
	| "instruction-following"
	| "creative-writing"
	| "autonomous-execution"

export type ModelTier = "premium" | "standard" | "economy"

export type SpeedClass = "fast" | "normal" | "slow-ok"

export type ModelEntry = {
	name: string
	providers: string[]
	capabilities: ModelCapability[]
	tier: ModelTier
	speed: SpeedClass
	costPer1MInputTokens?: number
	costPer1MOutputTokens?: number
	contextWindow?: number
	isUnstable?: boolean
	family?: string
}

export type ModelRegistry = Record<string, ModelEntry>
