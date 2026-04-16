import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { parseJsoncSafe } from "../../shared/jsonc-parser"
import { getOpenCodeConfigPaths } from "../../shared/opencode-config-dir"
import { log } from "../../shared/logger"

interface OpencodeSkillsConfig {
	skills?: {
		paths?: string[]
	}
}

interface ConfigSource {
	configPath: string
	resolveBaseDir: string
}

function getConfigPaths(baseDir: string): string[] {
	const configPaths: string[] = []

	const jsoncPath = join(baseDir, "opencode.jsonc")
	if (existsSync(jsoncPath)) configPaths.push(jsoncPath)

	const jsonPath = join(baseDir, "opencode.json")
	if (existsSync(jsonPath)) configPaths.push(jsonPath)

	return configPaths
}

function getConfigSources(directory: string): ConfigSource[] {
	const globalPaths = getOpenCodeConfigPaths({ binary: "opencode" })
	const sourceConfigs = [
		{ configDir: directory, resolveBaseDir: directory },
		{ configDir: join(directory, ".opencode"), resolveBaseDir: directory },
		{ configDir: globalPaths.configDir, resolveBaseDir: globalPaths.configDir },
	]

	return sourceConfigs.flatMap((sourceConfig) => {
		return getConfigPaths(sourceConfig.configDir).map((configPath) => ({
			configPath,
			resolveBaseDir: sourceConfig.resolveBaseDir,
		}))
		})
}

export function readOpenCodeSkillsPaths(directory: string): string[] {
	const resolvedPaths: string[] = []

	for (const source of getConfigSources(directory)) {
		try {
			const content = readFileSync(source.configPath, "utf-8")
			const result = parseJsoncSafe<OpencodeSkillsConfig>(content)
			if (!result.data?.skills?.paths) continue

			for (const item of result.data.skills.paths) {
				const resolved = item.startsWith("~/")
					? join(homedir(), item.slice(2))
					: isAbsolute(item)
						? item
						: join(source.resolveBaseDir, item)

				if (!existsSync(resolved)) {
					log(`[skill-loader] skills.paths entry not found: ${resolved}`)
					continue
				}

				resolvedPaths.push(resolved)
			}
		} catch {
			continue
		}
	}

	return [...new Set(resolvedPaths)]
}
