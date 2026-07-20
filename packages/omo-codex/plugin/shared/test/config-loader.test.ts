import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getCodexOmoConfig } from "../src/config-loader.ts"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix))
	temporaryDirectories.push(directory)
	return directory
}

function writeOmoConfig(homeDir: string, content: string): void {
	const configDir = join(homeDir, ".omo")
	mkdirSync(configDir, { recursive: true })
	writeFileSync(join(configDir, "config.jsonc"), content)
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true })
	}
})

describe("getCodexOmoConfig", () => {
	it("#given base and codex SOT blocks #when loading config #then returns the codex-merged effective config", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-")
		const cwd = createTemporaryDirectory("omo-codex-project-")
		writeOmoConfig(
			homeDir,
			JSON.stringify({
				codegraph: { enabled: true, install_dir: "/base" },
				"[codex]": { codegraph: { enabled: false } },
				"[opencode]": { codegraph: { install_dir: "/opencode-only" } },
			}),
		)

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.codegraph).toEqual({
			auto_provision: true,
			enabled: false,
			install_dir: "/base",
			telemetry: false,
		})
		expect(result.trustedCodegraphInstallDir).toBe("/base")
	})

	it("#given project SOT sets install_dir #when loading config #then only the effective value changes while trusted install root stays global", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-trusted-home-")
		const cwd = createTemporaryDirectory("omo-codex-shared-trusted-project-")
		writeOmoConfig(homeDir, JSON.stringify({ codegraph: { enabled: true, install_dir: "/global-codegraph" } }))
		writeOmoConfig(cwd, JSON.stringify({ codegraph: { install_dir: "/project-codegraph" } }))

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.codegraph?.install_dir).toBe("/project-codegraph")
		expect(result.trustedCodegraphInstallDir).toBe("/global-codegraph")
	})

	it("#given codex SOT sets CodeGraph excluded roots #when loading config #then roots are returned to hooks", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-excluded-home-")
		const cwd = createTemporaryDirectory("omo-codex-shared-excluded-project-")
		writeOmoConfig(
			homeDir,
			JSON.stringify({
				"[codex]": { codegraph: { excluded_roots: ["/tmp/omo-research", "/private/tmp/omo-research"] } },
			}),
		)

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.codegraph?.excluded_roots).toEqual(["/tmp/omo-research", "/private/tmp/omo-research"])
	})

	it("#given legacy env override and SOT value #when loading config #then env wins over the SOT", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-env-")
		const cwd = createTemporaryDirectory("omo-codex-project-env-")
		writeOmoConfig(homeDir, JSON.stringify({ codegraph: { enabled: true } }))

		// when
		const result = getCodexOmoConfig({
			cwd,
			homeDir,
			env: { CODEX_CODEGRAPH_ENABLED: "0" },
		})

		// then
		expect(result.codegraph?.enabled).toBe(false)
	})

	it("#given no SOT files #when loading config #then returns built-in defaults and missing global source", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-defaults-")
		const cwd = createTemporaryDirectory("omo-codex-project-defaults-")

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.codegraph).toEqual({
			auto_provision: true,
			enabled: true,
			telemetry: false,
		})
		expect(result.sources).toContainEqual({
			exists: false,
			loaded: false,
			path: join(homeDir, ".omo", "config.jsonc"),
			scope: "global",
		})
	})

	it("#given codex-unsupported codegraph setting #when loading config #then returns loader warnings", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-warnings-")
		const cwd = createTemporaryDirectory("omo-codex-project-warnings-")
		writeOmoConfig(homeDir, JSON.stringify({ "[codex]": { codegraph: { watch_debounce_ms: 42 } } }))

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.warnings).toContain("codegraph.watch_debounce_ms is not supported for harness codex")
	})
})
