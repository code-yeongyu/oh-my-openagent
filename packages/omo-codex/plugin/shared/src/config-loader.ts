import { homedir } from "node:os"

import {
	loadOmoConfig,
	type LoadOmoConfigOptions,
} from "../../../../utils/src/omo-config/loader.ts"
import type { OmoConfig } from "../../../../utils/src/omo-config.ts"
import type { OmoConfigSource } from "../../../../utils/src/omo-config/resolve.ts"

export type CodexOmoConfigOptions = Omit<LoadOmoConfigOptions, "harness">

export type CodexOmoConfig = OmoConfig & {
	readonly sources: readonly OmoConfigSource[]
	readonly trustedCodegraphInstallDir?: string
	readonly warnings: readonly string[]
}

export function getCodexOmoConfig(options: CodexOmoConfigOptions = {}): CodexOmoConfig {
	const env = options.env ?? process.env
	const homeDir = resolveHomeDir(options)
	const result = loadOmoConfig({
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
		env,
		homeDir,
		harness: "codex",
	})
	const trustedConfig = loadOmoConfig({
		cwd: homeDir,
		env,
		homeDir,
		harness: "codex",
	})
	const trustedCodegraphInstallDir = trustedConfig.config.codegraph?.install_dir

	return {
		...result.config,
		sources: result.sources,
		...(trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir }),
		warnings: result.warnings,
	}
}

function resolveHomeDir(options: CodexOmoConfigOptions): string {
	const env = options.env ?? process.env
	return options.homeDir ?? env["HOME"] ?? env["USERPROFILE"] ?? homedir()
}
