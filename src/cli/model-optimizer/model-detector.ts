import type { ModelInfo, ModelTier } from "./types"

const TIER_PATTERNS: Record<ModelTier, RegExp[]> = {
	flagship: [
		/opus/i,
		/gpt-5/i,
		/gpt-4(?!o-mini)(?!-turbo)/i, // gpt-4 but not gpt-4o-mini or gpt-4-turbo
		/pro(?!mpt)/i, // pro but not "prompt"
		/\bo1\b/i, // o1 as word
		/\bo3\b/i, // o3 as word
	],
	standard: [
		/sonnet/i,
		/flash(?!-lite)/i, // flash but not flash-lite
		/gpt-4o-mini/i,
		/turbo/i,
		/mistral-large/i,
	],
	lite: [/haiku/i, /nano/i, /flash-lite/i, /gpt-3\.5/i, /\bmini\b(?<!gpt-4o-)/i],
}

export function extractProvider(modelId: string): string {
	if (!modelId || !modelId.includes("/")) {
		return ""
	}
	return modelId.split("/")[0]
}

export function classifyTier(modelName: string): ModelTier {
	const lowerName = modelName.toLowerCase()

	for (const pattern of TIER_PATTERNS.flagship) {
		if (pattern.test(lowerName)) {
			return "flagship"
		}
	}

	// gpt-4o-mini is standard tier despite containing "mini"
	if (/gpt-4o-mini/i.test(lowerName)) {
		return "standard"
	}

	for (const pattern of TIER_PATTERNS.lite) {
		if (pattern.test(lowerName)) {
			return "lite"
		}
	}

	for (const pattern of TIER_PATTERNS.standard) {
		if (pattern.test(lowerName)) {
			return "standard"
		}
	}

	return "standard"
}

export function parseModelsOutput(output: string): ModelInfo[] {
	if (!output || !output.trim()) {
		return []
	}

	const lines = output.split("\n")
	const models: ModelInfo[] = []

	for (const line of lines) {
		const trimmed = line.trim()

		if (!trimmed) {
			continue
		}

		if (!trimmed.includes("/")) {
			continue
		}

		const provider = extractProvider(trimmed)
		const name = trimmed.substring(provider.length + 1)
		const tier = classifyTier(name)

		models.push({
			id: trimmed,
			provider,
			name,
			tier,
		})
	}

	return models
}

export async function detectAvailableModels(): Promise<ModelInfo[]> {
	try {
		const proc = Bun.spawn(["opencode", "models"], {
			stdout: "pipe",
			stderr: "pipe",
		})

		const output = await new Response(proc.stdout).text()
		const exitCode = await proc.exited

		if (exitCode !== 0) {
			return []
		}

		return parseModelsOutput(output)
	} catch {
		return []
	}
}
