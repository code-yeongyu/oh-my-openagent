import { z } from "zod"

/**
 * Model performance tier classification
 * - flagship: Top-tier models for complex tasks (e.g., claude-opus, gpt-4)
 * - standard: Balanced performance/cost (e.g., claude-sonnet, gpt-4o)
 * - lite: Fast, low-cost models (e.g., claude-haiku, gpt-4o-mini)
 */
export const ModelTierSchema = z.enum(["flagship", "standard", "lite"])
export type ModelTier = z.infer<typeof ModelTierSchema>

/**
 * Model information from `opencode models` output
 */
export const ModelInfoSchema = z.object({
	id: z.string(),
	provider: z.string(),
	name: z.string(),
	family: z.string().optional(),
	version: z.string().optional(),
	tier: ModelTierSchema,
})
export type ModelInfo = z.infer<typeof ModelInfoSchema>
