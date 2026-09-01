import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"

import { parse } from "jsonc-parser"

import { runMigrations, type MigrationBoundary } from "../../../../omo-config-core/src/index.ts"
import { createLegacyConfigMigrationPlans } from "../../../../omo-opencode/src/config-migration/index.ts"

import { getCodexOmoConfig, runCodexStartupMigration } from "../src/config-loader.ts"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix))
	temporaryDirectories.push(directory)
	return directory
}

function writeOmoConfig(homeDir: string, content: string): void {
	const configDir = join(homeDir, ".omo")
	mkdirSync(configDir, { recursive: true })
	writeFileSync(join(configDir, "omo.jsonc"), content)
}

function writeLegacyOmoConfig(homeDir: string, content: string): void {
	const configDir = join(homeDir, ".omo")
	mkdirSync(configDir, { recursive: true })
	writeFileSync(join(configDir, "config.jsonc"), content)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readOmoJson(homeDir: string): Record<string, unknown> {
	const value: unknown = parse(readFileSync(join(homeDir, ".omo", "omo.jsonc"), "utf-8"))
	if (!isRecord(value)) throw new Error("Expected an omo JSONC object")
	return value
}

function writeOpenCodeConfig(homeDir: string): void {
	const configDir = join(homeDir, ".config", "opencode")
	mkdirSync(configDir, { recursive: true })
	writeFileSync(join(configDir, "oh-my-openagent.jsonc"), '{"agents":{"finder":{"model":"provider/finder"}}}')
}

function runOpenCodeMigration(homeDir: string, cwd: string, onBoundary?: (boundary: MigrationBoundary) => void): void {
	runMigrations({
		discover: () => createLegacyConfigMigrationPlans({
			cwd,
			environment: { HOME: homeDir, XDG_CONFIG_HOME: join(homeDir, ".config") },
			homeDir,
			pathOperations: posix,
		}),
		env: { HOME: homeDir },
		...(onBoundary === undefined ? {} : { onBoundary }),
	})
}

function migrationIds(homeDir: string): readonly string[] {
	const migrations = readOmoJson(homeDir)["_migrations"]
	return Array.isArray(migrations) ? migrations.filter((entry): entry is string => typeof entry === "string") : []
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
			daemon: true,
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

	it("#given codex SOT sets the SessionStart cooldown #when loading config #then the configured base interval is returned", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-cooldown-home-")
		const cwd = createTemporaryDirectory("omo-codex-shared-cooldown-project-")
		writeOmoConfig(homeDir, JSON.stringify({ "[codex]": { codegraph: { session_start_cooldown_ms: 900_000 } } }))

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.codegraph?.session_start_cooldown_ms).toBe(900_000)
		expect(result.warnings).toEqual([])
	})

	it("#given no codegraph.daemon key #when loading config #then daemon defaults to on", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-daemon-default-home-")
		const cwd = createTemporaryDirectory("omo-codex-shared-daemon-default-project-")
		writeOmoConfig(homeDir, JSON.stringify({ codegraph: { enabled: true } }))

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.codegraph?.daemon).toBe(true)
		expect(result.warnings).toEqual([])
	})

	it("#given codex SOT sets codegraph.daemon=false #when loading config #then daemon opt-out is returned", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-daemon-off-home-")
		const cwd = createTemporaryDirectory("omo-codex-shared-daemon-off-project-")
		writeOmoConfig(homeDir, JSON.stringify({ "[codex]": { codegraph: { daemon: false } } }))

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.codegraph?.daemon).toBe(false)
		expect(result.warnings).toEqual([])
	})

	it("#given codex SOT sets codegraph.daemon to a non-boolean #when loading config #then the value is rejected with a warning", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-daemon-invalid-home-")
		const cwd = createTemporaryDirectory("omo-codex-shared-daemon-invalid-project-")
		writeOmoConfig(homeDir, JSON.stringify({ "[codex]": { codegraph: { daemon: "yes" } } }))

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.codegraph?.daemon).toBe(true)
		expect(result.warnings).toContain(`Invalid omo config at ${join(homeDir, ".omo", "omo.jsonc")}: [codex].codegraph.daemon`)
	})

	it("#given legacy env override and SOT value #when loading config #then env wins over the SOT", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-env-")
		const cwd = createTemporaryDirectory("omo-codex-project-env-")
		writeOmoConfig(homeDir, JSON.stringify({ codegraph: { enabled: false } }))

		// when
		const result = getCodexOmoConfig({
			cwd,
			homeDir,
			env: { CODEX_CODEGRAPH_ENABLED: "1" },
		})

		// then
		expect(result.codegraph?.enabled).toBe(true)
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
			daemon: true,
			enabled: true,
			telemetry: false,
		})
		expect(result.sources).toContainEqual({
			exists: false,
			loaded: false,
			path: join(homeDir, ".omo", "omo.jsonc"),
			scope: "user",
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

	it("#given only legacy config.jsonc #when codex starts #then migrates once with a backup before loading the unified codex view", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-legacy-upgrade-")
		writeLegacyOmoConfig(homeDir, JSON.stringify({ "[codex]": { codegraph: { daemon: false } } }))
		const legacyPath = join(homeDir, ".omo", "config.jsonc")

		// when
		const first = getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })
		const backupDirectories = readdirSync(join(homeDir, ".omo")).filter((entry) => entry.startsWith("migration-backup-"))
		const second = getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })

		// then
		expect(first.codegraph?.daemon).toBe(false)
		expect(first.warnings.some((warning) => warning.startsWith("omo-codex: migrated legacy configuration from ")
			&& warning.endsWith("/.omo/config.jsonc"))).toBe(true)
		expect(readOmoJson(homeDir)["_migrations"]).toEqual(["2026-07-codex-config-jsonc"])
		expect(existsSync(legacyPath)).toBe(false)
		expect(backupDirectories).toHaveLength(1)
		expect(existsSync(join(homeDir, ".omo", backupDirectories[0] ?? "", ".omo", "config.jsonc"))).toBe(true)
		expect(second.warnings.some((warning) => warning.startsWith("omo-codex: migrated legacy configuration from "))).toBe(false)
		expect(readdirSync(join(homeDir, ".omo")).filter((entry) => entry.startsWith("migration-backup-"))).toEqual(backupDirectories)
	})

	it("#given a legacy migration conflict #when codex starts #then exposes the migration summary and conflict through loader warnings", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-legacy-conflict-")
		writeOmoConfig(homeDir, JSON.stringify({ codegraph: { enabled: true } }))
		writeLegacyOmoConfig(homeDir, JSON.stringify({ codegraph: { enabled: false } }))

		// when
		const result = getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })

		// then
		expect(result.warnings.some((warning) => warning.startsWith("omo-codex: migrated legacy configuration from ")
			&& warning.endsWith("/.omo/config.jsonc"))).toBe(true)
		expect(result.warnings).toContain("omo-codex: configuration migration: skipped: codegraph.enabled legacy=false kept=true")
	})

	it("#given overlapping [omo] and [senpi] blocks in legacy config #when Codex migrates #then the transform conflict is reported", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-legacy-senpi-conflict-")
		writeLegacyOmoConfig(homeDir, JSON.stringify({
			"[omo]": { agents: { oracle: { model: "legacy" } } },
			"[senpi]": { agents: { oracle: { model: "current" } } },
		}))

		// when
		const result = runCodexStartupMigration({ cwd: homeDir, environment: { HOME: homeDir }, homeDir })

		// then
		expect(result.results[0]?.diagnostics).toContain("conflict: [senpi] legacy [omo] kept [senpi]")
	})

	it("#given a malformed migration journal #when codex starts #then exposes the recovery failure through loader warnings", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-recovery-warning-")
		const migrationDir = join(homeDir, ".omo")
		mkdirSync(migrationDir, { recursive: true })
		writeFileSync(join(migrationDir, ".migration-journal.json"), "not-json")

		// when
		const result = getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })

		// then
		expect(result.warnings.some((warning) => warning.startsWith("omo-codex: configuration migration: "))).toBe(true)
	})

	it("#given codex starts before opencode #when both legacy source groups exist #then each distinct migration id is applied once", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-order-codex-first-")
		writeLegacyOmoConfig(homeDir, JSON.stringify({ "[codex]": { codegraph: { daemon: false } } }))
		writeOpenCodeConfig(homeDir)
		const openCodeSource = join(homeDir, ".config", "opencode", "oh-my-openagent.jsonc")

		// when
		getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })
		const remainsAfterCodexStartup = existsSync(openCodeSource)
		runOpenCodeMigration(homeDir, homeDir)

		// then
		expect(remainsAfterCodexStartup).toBe(true)
		expect(existsSync(openCodeSource)).toBe(false)
		expect(migrationIds(homeDir)).toEqual(["2026-07-codex-config-jsonc", "2026-07-opencode-config-unification"])
	})

	it("#given opencode starts before codex #when both legacy source groups exist #then each distinct migration id is applied once", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-order-opencode-first-")
		writeLegacyOmoConfig(homeDir, JSON.stringify({ "[codex]": { codegraph: { daemon: false } } }))
		writeOpenCodeConfig(homeDir)

		// when
		runOpenCodeMigration(homeDir, homeDir)
		getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })

		// then
		expect(migrationIds(homeDir)).toEqual(["2026-07-opencode-config-unification", "2026-07-codex-config-jsonc"])
	})

	it("#given concurrent codex and opencode starts #when opencode owns the shared lock #then both migration ids are applied exactly once", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-order-concurrent-")
		writeLegacyOmoConfig(homeDir, JSON.stringify({ "[codex]": { codegraph: { daemon: false } } }))
		writeOpenCodeConfig(homeDir)
		let codexResult: ReturnType<typeof runCodexStartupMigration> | undefined

		// when
		runOpenCodeMigration(homeDir, homeDir, (boundary) => {
			if (boundary !== "journal-written" || codexResult !== undefined) return
			codexResult = runCodexStartupMigration({ cwd: homeDir, homeDir })
		})

		// then
		if (codexResult === undefined) throw new Error("Expected concurrent Codex migration attempt")
		expect(codexResult.error).toBe("Configuration migration is already running")
		expect(migrationIds(homeDir)).toEqual(["2026-07-opencode-config-unification", "2026-07-codex-config-jsonc"])
	})
})
