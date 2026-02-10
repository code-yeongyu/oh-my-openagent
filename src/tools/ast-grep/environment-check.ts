import { existsSync } from "fs"

import { CLI_LANGUAGES, NAPI_LANGUAGES } from "./language-support"
import { getSgCliPath } from "./sg-cli-path"

export interface EnvironmentCheckResult {
	cli: {
		available: boolean
		path: string
		error?: string
	}
	napi: {
		available: boolean
		error?: string
	}
}

/**
 * Check if ast-grep CLI and NAPI are available.
 * Call this at startup to provide early feedback about missing dependencies.
 */
export function checkEnvironment(): EnvironmentCheckResult {
	const cliPath = getSgCliPath()
	const result: EnvironmentCheckResult = {
		cli: {
			available: false,
			path: cliPath ?? "not found",
		},
		napi: {
			available: false,
		},
	}

	if (cliPath && existsSync(cliPath)) {
		result.cli.available = true
	} else if (!cliPath) {
		result.cli.error = "ast-grep binary not found. Install with: bun add -D @ast-grep/cli"
	} else {
		result.cli.error = `Binary not found: ${cliPath}`
	}

	// Check NAPI availability
	try {
		require("@ast-grep/napi")
		result.napi.available = true
	} catch (error) {
		result.napi.available = false
		result.napi.error = `@ast-grep/napi not installed: ${
			error instanceof Error ? error.message : String(error)
		}`
	}

	return result
}

/**
 * Format environment check result as user-friendly message.
 */
export function formatEnvironmentCheck(result: EnvironmentCheckResult): string {
	const lines: string[] = ["ast-grep Environment Status:", ""]

	// CLI status
	if (result.cli.available) {
		lines.push(`[OK] CLI: Available (${result.cli.path})`)
	} else {
		lines.push("[X] CLI: Not available")
		if (result.cli.error) {
			lines.push(`  Error: ${result.cli.error}`)
		}
		lines.push("  Install: bun add -D @ast-grep/cli")
	}

	// NAPI status
	if (result.napi.available) {
		lines.push("[OK] NAPI: Available")
	} else {
		lines.push("[X] NAPI: Not available")
		if (result.napi.error) {
			lines.push(`  Error: ${result.napi.error}`)
		}
		lines.push("  Install: bun add -D @ast-grep/napi")
	}

	lines.push("")
	lines.push(`CLI supports ${CLI_LANGUAGES.length} languages`)
	lines.push(`NAPI supports ${NAPI_LANGUAGES.length} languages: ${NAPI_LANGUAGES.join(", ")}`)

	return lines.join("\n")
}
