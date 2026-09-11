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
				telemetry: { enabled: true },
				"[codex]": { telemetry: { enabled: false } },
				"[opencode]": { telemetry: { enabled: true } },
			}),
		)

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.telemetry?.enabled).toBe(false)
		expect(result.warnings).toEqual([])
	})

	it("#given a project SOT layer #when loading config #then the project value overrides the user layer", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-project-home-")
		const cwd = createTemporaryDirectory("omo-codex-shared-project-project-")
		writeOmoConfig(homeDir, JSON.stringify({ task: { default_concurrency: 3 } }))
		writeOmoConfig(cwd, JSON.stringify({ task: { default_concurrency: 7 } }))

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.task?.default_concurrency).toBe(7)
	})

	it("#given a codex SOT setting with the wrong type #when loading config #then the value is rejected with a warning", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-invalid-home-")
		const cwd = createTemporaryDirectory("omo-codex-shared-invalid-project-")
		writeOmoConfig(homeDir, JSON.stringify({ telemetry: { enabled: true }, "[codex]": { telemetry: { enabled: "yes" } } }))

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.telemetry).toBeUndefined()
		expect(result.warnings).toContain(`Invalid omo config at ${join(homeDir, ".omo", "omo.jsonc")}: [codex].telemetry.enabled`)
	})

	it("#given no SOT files #when loading config #then returns built-in defaults and missing global source", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-shared-defaults-")
		const cwd = createTemporaryDirectory("omo-codex-project-defaults-")

		// when
		const result = getCodexOmoConfig({ cwd, homeDir, env: {} })

		// then
		expect(result.telemetry).toBeUndefined()
		expect(result.warnings).toEqual([])
		expect(result.sources).toContainEqual({
			exists: false,
			loaded: false,
			path: join(homeDir, ".omo", "omo.jsonc"),
			scope: "user",
		})
	})

	it("#given only legacy config.jsonc #when codex starts #then migrates once with a backup before loading the unified codex view", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-legacy-upgrade-")
		writeLegacyOmoConfig(homeDir, JSON.stringify({ "[codex]": { telemetry: { enabled: false } } }))
		const legacyPath = join(homeDir, ".omo", "config.jsonc")

		// when
		const first = getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })
		const backupDirectories = readdirSync(join(homeDir, ".omo")).filter((entry) => entry.startsWith("migration-backup-"))
		const second = getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })

		// then
		expect(first.telemetry?.enabled).toBe(false)
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
		writeOmoConfig(homeDir, JSON.stringify({ "[codex]": { telemetry: { enabled: true } } }))
		writeLegacyOmoConfig(homeDir, JSON.stringify({ "[codex]": { telemetry: { enabled: false } } }))

		// when
		const result = getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })

		// then
		expect(result.warnings.some((warning) => warning.startsWith("omo-codex: migrated legacy configuration from ")
			&& warning.endsWith("/.omo/config.jsonc"))).toBe(true)
		expect(result.warnings).toContain("omo-codex: configuration migration: skipped: [codex].telemetry.enabled legacy=false kept=true")
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
		writeLegacyOmoConfig(homeDir, JSON.stringify({ "[codex]": { telemetry: { enabled: false } } }))
		writeOpenCodeConfig(homeDir)
		const openCodeSource = join(homeDir, ".config", "opencode", "oh-my-openagent.jsonc")

		// when
		getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })
		const remainsAfterCodexStartup = existsSync(openCodeSource)
		runOpenCodeMigration(homeDir, homeDir)

		// then
		expect(remainsAfterCodexStartup).toBe(true)
		expect(existsSync(openCodeSource)).toBe(false)
		expect(migrationIds(homeDir)).toEqual([
			"2026-07-codex-config-jsonc",
			"2026-07-opencode-config-unification",
			"2026-08-reasoning-unification",
		])
	})

	it("#given opencode starts before codex #when both legacy source groups exist #then each distinct migration id is applied once", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-order-opencode-first-")
		writeLegacyOmoConfig(homeDir, JSON.stringify({ "[codex]": { telemetry: { enabled: false } } }))
		writeOpenCodeConfig(homeDir)

		// when
		runOpenCodeMigration(homeDir, homeDir)
		getCodexOmoConfig({ cwd: homeDir, homeDir, env: {} })

		// then
		expect(migrationIds(homeDir)).toEqual([
			"2026-07-opencode-config-unification",
			"2026-07-codex-config-jsonc",
			"2026-08-reasoning-unification",
		])
	})

	it("#given concurrent codex and opencode starts #when opencode owns the shared lock #then both migration ids are applied exactly once", () => {
		// given
		const homeDir = createTemporaryDirectory("omo-codex-order-concurrent-")
		writeLegacyOmoConfig(homeDir, JSON.stringify({ "[codex]": { telemetry: { enabled: false } } }))
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
		expect(migrationIds(homeDir)).toEqual([
			"2026-07-opencode-config-unification",
			"2026-07-codex-config-jsonc",
			"2026-08-reasoning-unification",
		])
	})
})
