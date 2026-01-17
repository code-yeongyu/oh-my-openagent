/**
 * Static model rankings by category.
 *
 * HELP WANTED: We need help ranking AI models!
 * If you have experience with these models and can help improve the rankings,
 * please contribute: https://github.com/code-yeongyu/oh-my-opencode/issues
 *
 * HOW TO MODIFY RANKINGS:
 * ========================
 *
 * 1. MODEL_RANKINGS - Add/reorder models within categories:
 *    - Each category is an array ordered from BEST to WORST
 *    - Higher position = higher preference when user runs `model-config`
 *    - Model IDs must match exactly what `opencode models` outputs
 *    - Example: "anthropic/claude-opus-4-5", "openai/gpt-5.2"
 *
 * 2. AGENT_RANKING_MAP - Map agents to ranking categories:
 *    - Key: agent name (e.g., "oracle", "Sisyphus")
 *    - Value: which MODEL_RANKINGS category to use
 *    - When user runs `model-config`, agent gets best available model from its category
 *
 * 3. CATEGORY_RANKING_MAP - Map task categories to ranking categories:
 *    - Key: task category from delegate_task (e.g., "quick", "visual-engineering")
 *    - Value: which MODEL_RANKINGS category to use
 *
 * 4. CATEGORY_TEMPERATURES / CATEGORY_VARIANTS - Per-category defaults:
 *    - Temperature: 0.1 (deterministic) to 0.9 (creative)
 *    - Variant: "low", "medium", "high", "max" (thinking effort)
 *
 * TESTING YOUR CHANGES:
 *   bun test src/cli/model-optimizer/  # Run tests
 *   bunx oh-my-opencode model-config   # See generated config
 *   bunx oh-my-opencode model-config --verbose  # See full rankings
 */
export const MODEL_RANKINGS = {
	// Best overall (orchestrator, complex tasks)
	orchestrator: [
		"anthropic/claude-opus-4-5",
		"google/antigravity-claude-opus-4-5-thinking",
		"openai/gpt-5.2",
		"openai/gpt-5.2-codex",
		"openai/gpt-5.1-codex-max",
		"anthropic/claude-sonnet-4-5",
		"google/antigravity-claude-sonnet-4-5-thinking",
		"google/antigravity-claude-sonnet-4-5",
		"google/gemini-3-pro-preview",
		"google/antigravity-gemini-3-pro",
		"google/gemini-2.5-pro",
		"google/gemini-2.5-pro-preview-06-05",
		"google/gemini-2.5-pro-preview-05-06",
		"openai/gpt-5.1-codex-mini",
		"google/gemini-3-flash-preview",
		"google/antigravity-gemini-3-flash",
		"google/gemini-2.5-flash",
		"google/gemini-2.5-flash-preview-05-20",
		"zai-coding-plan/glm-4.7",
		"zai-coding-plan/glm-4.6",
		"zai-coding-plan/glm-4.6v",
		"opencode/glm-4.7-free",
		"opencode/grok-code",
		"opencode/gpt-5-nano",
	],

	// Best reasoning (oracle, debugging, architecture)
	reasoning: [
		"openai/gpt-5.2",
		"openai/gpt-5.2-codex",
		"anthropic/claude-opus-4-5",
		"google/antigravity-claude-opus-4-5-thinking",
		"openai/gpt-5.1-codex-max",
		"anthropic/claude-sonnet-4-5",
		"google/antigravity-claude-sonnet-4-5-thinking",
		"google/gemini-3-pro-preview",
		"google/antigravity-gemini-3-pro",
		"google/gemini-2.5-pro",
		"google/gemini-2.5-pro-preview-06-05",
		"google/antigravity-claude-sonnet-4-5",
		"openai/gpt-5.1-codex-mini",
		"google/gemini-3-flash-preview",
		"google/antigravity-gemini-3-flash",
		"google/gemini-2.5-flash",
		"zai-coding-plan/glm-4.7",
		"zai-coding-plan/glm-4.6",
		"opencode/glm-4.7-free",
		"opencode/grok-code",
	],

	// Fast + capable (explore, quick lookups)
	fast: [
		"google/gemini-3-flash-preview",
		"google/antigravity-gemini-3-flash",
		"google/gemini-2.5-flash",
		"google/gemini-2.5-flash-preview-05-20",
		"google/gemini-2.5-flash-lite",
		"google/gemini-2.0-flash",
		"google/gemini-2.0-flash-lite",
		"google/gemini-1.5-flash",
		"google/gemini-1.5-flash-8b",
		"openai/gpt-5.1-codex-mini",
		"opencode/grok-code",
		"opencode/gpt-5-nano",
		"zai-coding-plan/glm-4.5-flash",
		"zai-coding-plan/glm-4.5-air",
		"anthropic/claude-sonnet-4-5",
		"google/antigravity-claude-sonnet-4-5",
		"google/antigravity-gemini-3-pro",
		"zai-coding-plan/glm-4.7",
		"opencode/glm-4.7-free",
	],

	// Best coding (frontend, implementation)
	coding: [
		"anthropic/claude-sonnet-4-5",
		"google/antigravity-claude-sonnet-4-5",
		"google/antigravity-claude-sonnet-4-5-thinking",
		"anthropic/claude-opus-4-5",
		"google/antigravity-claude-opus-4-5-thinking",
		"openai/gpt-5.2-codex",
		"openai/gpt-5.1-codex-max",
		"openai/gpt-5.2",
		"google/gemini-3-pro-preview",
		"google/antigravity-gemini-3-pro",
		"google/gemini-2.5-pro",
		"openai/gpt-5.1-codex-mini",
		"google/gemini-3-flash-preview",
		"google/antigravity-gemini-3-flash",
		"google/gemini-2.5-flash",
		"opencode/grok-code",
		"zai-coding-plan/glm-4.7",
		"zai-coding-plan/glm-4.6",
		"opencode/glm-4.7-free",
	],

	// Best instruction-following (librarian, document-writer)
	instruction: [
		"anthropic/claude-sonnet-4-5",
		"google/antigravity-claude-sonnet-4-5",
		"anthropic/claude-opus-4-5",
		"google/antigravity-claude-opus-4-5-thinking",
		"openai/gpt-5.2",
		"openai/gpt-5.2-codex",
		"google/gemini-3-pro-preview",
		"google/antigravity-gemini-3-pro",
		"google/gemini-2.5-pro",
		"openai/gpt-5.1-codex-max",
		"google/gemini-3-flash-preview",
		"google/antigravity-gemini-3-flash",
		"google/gemini-2.5-flash",
		"openai/gpt-5.1-codex-mini",
		"zai-coding-plan/glm-4.7",
		"zai-coding-plan/glm-4.6",
		"opencode/glm-4.7-free",
	],

	// Multimodal / vision capable
	multimodal: [
		"google/gemini-3-pro-preview",
		"google/antigravity-gemini-3-pro",
		"google/gemini-2.5-pro",
		"google/gemini-3-flash-preview",
		"google/antigravity-gemini-3-flash",
		"google/gemini-2.5-flash",
		"google/gemini-2.5-flash-image",
		"google/gemini-2.5-flash-image-preview",
		"google/gemini-2.0-flash",
		"google/gemini-1.5-pro",
		"google/gemini-1.5-flash",
		"anthropic/claude-opus-4-5",
		"google/antigravity-claude-opus-4-5-thinking",
		"anthropic/claude-sonnet-4-5",
		"google/antigravity-claude-sonnet-4-5",
		"openai/gpt-5.2",
		"zai-coding-plan/glm-4.6v",
		"zai-coding-plan/glm-4.5v",
	],

	// Creative / artistic
	creative: [
		"google/antigravity-gemini-3-pro",
		"google/gemini-3-pro-preview",
		"google/gemini-2.5-pro",
		"anthropic/claude-opus-4-5",
		"google/antigravity-claude-opus-4-5-thinking",
		"anthropic/claude-sonnet-4-5",
		"google/antigravity-claude-sonnet-4-5",
		"openai/gpt-5.2",
		"google/antigravity-gemini-3-flash",
		"google/gemini-3-flash-preview",
		"google/gemini-2.5-flash",
		"zai-coding-plan/glm-4.7",
		"opencode/glm-4.7-free",
	],

	// Free/cheap fallback
	free: [
		"opencode/glm-4.7-free",
		"opencode/grok-code",
		"opencode/gpt-5-nano",
		"opencode/minimax-m2.1-free",
		"opencode/big-pickle",
		"zai-coding-plan/glm-4.5-flash",
		"zai-coding-plan/glm-4.5-air",
		"google/gemini-2.5-flash-lite",
		"google/gemini-2.0-flash-lite",
		"google/gemini-1.5-flash-8b",
	],
} as const

export type RankingCategory = keyof typeof MODEL_RANKINGS

export const AGENT_RANKING_MAP: Record<string, RankingCategory> = {
	"Sisyphus": "orchestrator",
	"Sisyphus-Junior": "orchestrator",
	"orchestrator-sisyphus": "orchestrator",
	"oracle": "reasoning",
	"explore": "fast",
	"librarian": "instruction",
	"frontend-ui-ux-engineer": "coding",
	"document-writer": "instruction",
	"multimodal-looker": "multimodal",
	"Metis (Plan Consultant)": "reasoning",
	"Momus (Plan Reviewer)": "reasoning",
	"Prometheus (Planner)": "orchestrator",
	"build": "orchestrator",
	"plan": "orchestrator",
	"OpenCode-Builder": "coding",
	"general": "orchestrator",
}

export const CATEGORY_RANKING_MAP: Record<string, RankingCategory> = {
	"quick": "fast",
	"general": "orchestrator",
	"visual-engineering": "coding",
	"ultrabrain": "reasoning",
	"most-capable": "orchestrator",
	"writing": "instruction",
	"artistry": "creative",
}

export const CATEGORY_TEMPERATURES: Record<string, number> = {
	"quick": 0.3,
	"general": 0.3,
	"visual-engineering": 0.7,
	"ultrabrain": 0.1,
	"most-capable": 0.1,
	"writing": 0.5,
	"artistry": 0.9,
}

export const CATEGORY_VARIANTS: Record<string, string> = {
	"quick": "low",
	"general": "low",
	"visual-engineering": "high",
	"ultrabrain": "max",
	"most-capable": "max",
	"writing": "low",
	"artistry": "medium",
}

export function findBestModel(
	availableModelIds: string[],
	category: RankingCategory
): string | null {
	const ranking = MODEL_RANKINGS[category]
	const availableSet = new Set(availableModelIds)

	for (const modelId of ranking) {
		if (availableSet.has(modelId)) {
			return modelId
		}
	}

	for (const modelId of MODEL_RANKINGS.free) {
		if (availableSet.has(modelId)) {
			return modelId
		}
	}

	return availableModelIds[0] ?? null
}

export function generateOptimalConfig(
	availableModelIds: string[]
): { agents: Record<string, { model: string; variant?: string }>; categories: Record<string, { model: string; variant: string; temperature: number }> } {
	const agents: Record<string, { model: string; variant?: string }> = {}
	const categories: Record<string, { model: string; variant: string; temperature: number }> = {}

	for (const [agent, rankingCategory] of Object.entries(AGENT_RANKING_MAP)) {
		const model = findBestModel(availableModelIds, rankingCategory)
		if (model) {
			agents[agent] = { model }
			if (agent === "Sisyphus" || agent === "orchestrator-sisyphus" || agent === "Prometheus (Planner)" || agent === "build" || agent === "plan") {
				agents[agent].variant = "max"
			} else if (agent === "Sisyphus-Junior") {
				agents[agent].variant = "high"
			} else if (agent === "frontend-ui-ux-engineer") {
				agents[agent].variant = "high"
			} else if (agent === "librarian" || agent === "explore" || agent === "document-writer" || agent === "multimodal-looker" || agent === "general") {
				agents[agent].variant = "low"
			}
		}
	}

	for (const [category, rankingCategory] of Object.entries(CATEGORY_RANKING_MAP)) {
		const model = findBestModel(availableModelIds, rankingCategory)
		if (model) {
			categories[category] = {
				model,
				variant: CATEGORY_VARIANTS[category] ?? "low",
				temperature: CATEGORY_TEMPERATURES[category] ?? 0.3,
			}
		}
	}

	return { agents, categories }
}
