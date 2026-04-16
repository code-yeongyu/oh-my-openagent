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
	baseDir: string
}

function getConfigPath(baseDir: string): string | null {
	const jsoncPath = join(baseDir, "opencode.jsonc")
	if (existsSync(jsoncPath)) return jsoncPath

	const jsonPath = join(baseDir, "opencode.json")
	if (existsSync(jsonPath)) return jsonPath

	return null
}

function getConfigSources(directory: string): ConfigSource[] {
	const globalPaths = getOpenCodeConfigPaths({ binary: "opencode" })
	const sourceDirs = [
		directory,
		join(directory, ".opencode"),
		globalPaths.configDir,
	]

	return sourceDirs
		.map((baseDir) => {
			const configPath = getConfigPath(baseDir)
			if (!configPath) return null

			return { configPath, baseDir }
		})
		.filter((source): source is ConfigSource => source !== null)
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
						: join(source.baseDir, item)

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
