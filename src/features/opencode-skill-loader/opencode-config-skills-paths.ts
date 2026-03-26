import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { parseJsoncSafe } from "../../shared/jsonc-parser"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import { log } from "../../shared/logger"

interface OpencodeSkillsConfig {
	skills?: {
		paths?: string[]
	}
}

function getConfigPaths(directory: string): string[] {
	const globalDir = getOpenCodeConfigDir({ binary: "opencode" })
	return [
		join(directory, ".opencode", "opencode.json"),
		join(directory, ".opencode", "opencode.jsonc"),
		join(directory, "opencode.json"),
		join(directory, "opencode.jsonc"),
		join(globalDir, "opencode.json"),
		join(globalDir, "opencode.jsonc"),
	]
}

export function readOpenCodeSkillsPaths(directory: string): string[] {
	for (const configPath of getConfigPaths(directory)) {
		if (!existsSync(configPath)) continue

		try {
			const content = readFileSync(configPath, "utf-8")
			const result = parseJsoncSafe<OpencodeSkillsConfig>(content)
			if (!result.data?.skills?.paths) continue

			return result.data.skills.paths
				.map((item) => {
					if (item.startsWith("~/")) return join(homedir(), item.slice(2))
					return isAbsolute(item) ? item : join(directory, item)
				})
				.filter((resolved) => {
					if (!existsSync(resolved)) {
						log(`[skill-loader] skills.paths entry not found: ${resolved}`)
						return false
					}
					return true
				})
		} catch {
			continue
		}
	}

	return []
}
