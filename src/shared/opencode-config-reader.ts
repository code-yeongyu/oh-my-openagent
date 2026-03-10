import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { log } from "./logger"
import { parseJsonc } from "./jsonc-parser"
import { getOpenCodeConfigDir } from "./opencode-config-dir"

interface OpenCodeProviderConfig {
	models?: Record<string, unknown>
}

interface OpenCodeConfig {
	provider?: Record<string, OpenCodeProviderConfig>
}

/**
 * Read opencode.json/opencode.jsonc and extract user-configured models per provider.
 * Returns a map of provider ID → Set of configured model IDs.
 * 
 * @example
 * // opencode.json contains:
 * // { "provider": { "minimax": { "models": { "MiniMax-M2.5-highspeed": {...} } } } }
 * 
 * const whitelist = readUserConfiguredModels()
 * // → Map { "minimax" => Set { "MiniMax-M2.5-highspeed" } }
 */
export function readUserConfiguredModels(): Map<string, Set<string>> | null {
	const configDir = getOpenCodeConfigDir({ binary: "opencode", version: null })
	const configPaths = [
		join(configDir, "opencode.json"),
		join(configDir, "opencode.jsonc"),
	]

	let configContent: string | null = null
	let configPath: string | null = null

	for (const path of configPaths) {
		if (existsSync(path)) {
			try {
				configContent = readFileSync(path, "utf-8")
				configPath = path
				break
			} catch (err) {
				log("[opencode-config-reader] Error reading config file", { path, error: String(err) })
			}
		}
	}

	if (!configContent || !configPath) {
		log("[opencode-config-reader] No opencode config file found")
		return null
	}

	try {
		const config = parseJsonc<OpenCodeConfig>(configContent)

		if (!config?.provider) {
			log("[opencode-config-reader] No provider config found")
			return null
		}

		const whitelist = new Map<string, Set<string>>()

		for (const [providerId, providerConfig] of Object.entries(config.provider)) {
			if (!providerConfig?.models) {
				continue
			}

			const modelIds = Object.keys(providerConfig.models)
			if (modelIds.length > 0) {
				whitelist.set(providerId, new Set(modelIds))
			}
		}

		log("[opencode-config-reader] Extracted user-configured models", {
			providerCount: whitelist.size,
			providers: Array.from(whitelist.keys()),
			totalModels: Array.from(whitelist.values()).reduce((sum, set) => sum + set.size, 0),
		})

		return whitelist
	} catch (err) {
		log("[opencode-config-reader] Error parsing config file", { path: configPath, error: String(err) })
		return null
	}
}
