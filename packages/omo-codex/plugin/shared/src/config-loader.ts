import {
	loadOmoConfig,
	type LoadOmoConfigOptions,
} from "../../../../utils/src/omo-config/loader.ts"
import type { OmoConfig } from "../../../../utils/src/omo-config.ts"
import type { OmoConfigSource } from "../../../../utils/src/omo-config/resolve.ts"

export type CodexOmoConfigOptions = Omit<LoadOmoConfigOptions, "harness">

export type CodexOmoConfig = OmoConfig & {
	readonly sources: readonly OmoConfigSource[]
	readonly warnings: readonly string[]
}

export function getCodexOmoConfig(options: CodexOmoConfigOptions = {}): CodexOmoConfig {
	const result = loadOmoConfig({
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
		...(options.env === undefined ? {} : { env: options.env }),
		...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
		harness: "codex",
	})

	return {
		...result.config,
		sources: result.sources,
		warnings: result.warnings,
	}
}
