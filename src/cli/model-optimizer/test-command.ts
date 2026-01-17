import color from "picocolors"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { detectAvailableModels } from "./model-detector"
import { MODEL_RANKINGS, AGENT_RANKING_MAP, CATEGORY_RANKING_MAP, generateOptimalConfig } from "./rankings"
import type { RankingCategory } from "./rankings"
import { parseJsonc } from "../../shared"

export interface TestModelsOptions {
	verbose?: boolean
	apply?: boolean
}

function printHeader(title: string): void {
	console.log()
	console.log(color.bgCyan(color.black(` ${title} `)))
	console.log()
}

function printSection(title: string): void {
	console.log()
	console.log(color.bold(color.white(title)))
	console.log(color.dim("─".repeat(60)))
}

export async function testModels(options: TestModelsOptions): Promise<number> {
	printHeader("Model Optimizer - Rankings View")

	console.log("Detecting available models...")
	const allModels = await detectAvailableModels()

	if (allModels.length === 0) {
		console.log(color.red("No models detected. Run 'opencode models' to verify."))
		return 1
	}

	const availableIds = allModels.map(m => m.id)
	console.log(`Found ${color.cyan(allModels.length.toString())} models`)

	printSection("YOUR AVAILABLE MODELS")
	for (const model of allModels) {
		const tierColor = model.tier === "flagship" ? color.green : model.tier === "standard" ? color.yellow : color.dim
		console.log(`  ${tierColor("●")} ${model.id} ${color.dim(`(${model.tier})`)}`)
	}

	const config = generateOptimalConfig(availableIds)

	printSection("OPTIMAL AGENT → MODEL MAPPING")
	console.log()

	for (const [agent, agentConfig] of Object.entries(config.agents)) {
		const category = AGENT_RANKING_MAP[agent]
		const ranking = category ? MODEL_RANKINGS[category] : []
		const rank = agentConfig.model ? (ranking as readonly string[]).indexOf(agentConfig.model) + 1 : -1

		const rankStr = rank > 0 ? `#${rank}` : ""
		const variantStr = agentConfig.variant ? color.dim(` (${agentConfig.variant})`) : ""
		console.log(`  ${color.cyan(agent.padEnd(28))} → ${color.green(agentConfig.model)}${variantStr} ${color.dim(rankStr)}`)
	}

	printSection("OPTIMAL CATEGORY → MODEL MAPPING")
	console.log()

	for (const [category, catConfig] of Object.entries(config.categories)) {
		const rankingCategory = CATEGORY_RANKING_MAP[category]
		const ranking = rankingCategory ? MODEL_RANKINGS[rankingCategory] : []
		const rank = catConfig.model ? (ranking as readonly string[]).indexOf(catConfig.model) + 1 : -1

		const rankStr = rank > 0 ? `#${rank}` : ""
		const detailStr = color.dim(` (${catConfig.variant}, temp=${catConfig.temperature})`)
		console.log(`  ${color.cyan(category.padEnd(20))} → ${color.green(catConfig.model)}${detailStr} ${color.dim(rankStr)}`)
	}

	if (options.verbose) {
		printSection("FULL RANKINGS BY CATEGORY")

		for (const [category, ranking] of Object.entries(MODEL_RANKINGS)) {
			console.log()
			console.log(color.bold(category.toUpperCase()))

			for (let i = 0; i < ranking.length; i++) {
				const modelId = ranking[i]
				const available = availableIds.includes(modelId)
				const marker = available ? color.green("✓") : color.dim("○")
				const text = available ? color.white(modelId) : color.dim(modelId)
				console.log(`  ${(i + 1).toString().padStart(2)}. ${marker} ${text}`)
			}
		}
	}

	if (options.apply) {
		const result = applyConfig(config)
		if (result.success) {
			printSection("CONFIG APPLIED")
			console.log()
			console.log(color.green(`✓ Config written to: ${result.path}`))
			if (result.merged) {
				console.log(color.dim("  (merged with existing config)"))
			}
		} else {
			printSection("CONFIG APPLY FAILED")
			console.log()
			console.log(color.red(`✗ ${result.error}`))
			return 1
		}
	} else {
		printSection("RECOMMENDED CONFIG")
		console.log()
		console.log(color.dim("Add to your oh-my-opencode.json:"))
		console.log()
		console.log(color.cyan(JSON.stringify(config, null, 2)))
		console.log()
		console.log(color.dim("Use --apply to write this config automatically"))
	}

	console.log()
	console.log(color.dim("Use --verbose to see full rankings"))

	return 0
}

interface ApplyResult {
	success: boolean
	path?: string
	merged?: boolean
	error?: string
}

function applyConfig(config: { agents: Record<string, { model: string; variant?: string }>; categories: Record<string, { model: string; variant: string; temperature: number }> }): ApplyResult {
	const configDir = join(homedir(), ".config", "opencode")
	const configPath = join(configDir, "oh-my-opencode.json")

	try {
		if (!existsSync(configDir)) {
			mkdirSync(configDir, { recursive: true })
		}

		let existingConfig: Record<string, unknown> = {}
		let merged = false

		if (existsSync(configPath)) {
			try {
				const content = readFileSync(configPath, "utf-8")
				if (content.trim()) {
					const parsed = parseJsonc<Record<string, unknown>>(content)
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						existingConfig = parsed
						merged = true
					}
				}
			} catch {
				// If parsing fails, we'll overwrite with new config
			}
		}

		const newConfig = {
			...existingConfig,
			agents: {
				...(existingConfig.agents as Record<string, unknown> ?? {}),
				...config.agents,
			},
			categories: {
				...(existingConfig.categories as Record<string, unknown> ?? {}),
				...config.categories,
			},
		}

		writeFileSync(configPath, JSON.stringify(newConfig, null, 2) + "\n")

		return { success: true, path: configPath, merged }
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}
