import { homedir } from "node:os"

import {
	loadOmoConfig,
	mergeOmoConfigRecords,
	OmoConfigSchema,
	type LoadOmoConfigOptions,
	type MigrationEnvironment,
	type MigrationFileSystem,
	type OmoConfig,
	type OmoConfigEnv,
	type OmoConfigSource,
} from "../../../../omo-config-core/src/index.ts"

import {
	runCodexConfigMigration,
	type CodexConfigMigrationOptions,
	type CodexConfigMigrationResult,
} from "./config-migration.ts"

export type CodexOmoConfigOptions = Omit<LoadOmoConfigOptions, "fileSystem" | "harness"> & {
	readonly fileSystem?: MigrationFileSystem
	readonly homeDir?: string
}

export type CodexStartupMigrationOptions = CodexConfigMigrationOptions
export type CodexStartupMigrationResult = CodexConfigMigrationResult

type CodexCodegraphConfig = {
	readonly auto_provision?: boolean
	readonly daemon?: boolean
	readonly enabled?: boolean
	readonly excluded_roots?: readonly string[]
	readonly install_dir?: string
	readonly session_start_cooldown_ms?: number
	readonly telemetry?: boolean
	readonly watch_debounce_ms?: number
}

type CodexResolvedConfig = Omit<OmoConfig, "codegraph"> & {
	readonly codegraph?: CodexCodegraphConfig
}

export type CodexOmoConfig = CodexResolvedConfig & {
	readonly sources: readonly OmoConfigSource[]
	readonly trustedCodegraphInstallDir?: string
	readonly warnings: readonly string[]
}

const ENV_BOOLEAN_SETTINGS = [
	["auto_provision", "AUTO_PROVISION"],
	["enabled", "ENABLED"],
	["telemetry", "TELEMETRY"],
] as const

function resolveHomeDir(options: CodexOmoConfigOptions): string {
	const env = options.env ?? process.env
	return options.homeDir ?? env.HOME ?? env.USERPROFILE ?? homedir()
}

function environmentWithHome(env: OmoConfigEnv, homeDir: string): OmoConfigEnv {
	return { ...env, HOME: homeDir }
}

function migrationEnvironment(homeDir: string, env: OmoConfigEnv): MigrationEnvironment {
	return {
		HOME: homeDir,
		...(env.USERPROFILE === undefined ? {} : { USERPROFILE: env.USERPROFILE }),
	}
}

/** Runs only the legacy config.jsonc transaction before Codex reads omo.jsonc. */
export function runCodexStartupMigration(options: CodexStartupMigrationOptions): CodexStartupMigrationResult {
	return runCodexConfigMigration(options)
}

function parseBoolean(value: string): boolean | undefined {
	const normalized = value.trim().toLowerCase()
	if (["1", "true", "yes", "on"].includes(normalized)) return true
	if (["0", "false", "no", "off"].includes(normalized)) return false
	return undefined
}

function envOverrides(env: OmoConfigEnv, warnings: string[]): Record<string, unknown> {
	const codegraph: Record<string, unknown> = {}
	for (const prefix of ["OMO", "CODEX"]) {
		for (const [setting, suffix] of ENV_BOOLEAN_SETTINGS) {
			const name = `${prefix}_CODEGRAPH_${suffix}`
			const rawValue = env[name]
			if (rawValue === undefined) continue
			const value = parseBoolean(rawValue)
			if (value === undefined) warnings.push(`${name} has invalid boolean value "${rawValue}"`)
			else codegraph[setting] = value
		}

		const installDir = env[`${prefix}_CODEGRAPH_INSTALL_DIR`]
		if (installDir !== undefined) codegraph["install_dir"] = installDir
		const cooldown = env[`${prefix}_CODEGRAPH_SESSION_START_COOLDOWN_MS`]
		if (cooldown !== undefined) {
			const value = Number(cooldown)
			if (!Number.isFinite(value) || value < 60_000) {
				warnings.push(`${prefix}_CODEGRAPH_SESSION_START_COOLDOWN_MS has invalid number value "${cooldown}"`)
			} else codegraph["session_start_cooldown_ms"] = value
		}
		const debounce = env[`${prefix}_CODEGRAPH_WATCH_DEBOUNCE_MS`]
		if (debounce !== undefined) {
			const value = Number(debounce)
			if (!Number.isFinite(value) || value < 0) warnings.push(`${prefix}_CODEGRAPH_WATCH_DEBOUNCE_MS has invalid number value "${debounce}"`)
			else codegraph["watch_debounce_ms"] = value
		}
	}
	return Object.keys(codegraph).length === 0 ? {} : { codegraph }
}

function migrationWarnings(result: CodexStartupMigrationResult): readonly string[] {
	const warnings: string[] = []
	if (result.error !== undefined) warnings.push(`omo-codex: configuration migration: ${result.error}`)
	if (result.journalResumed) warnings.push("omo-codex: recovered an interrupted configuration migration")
	if (result.migratedFrom.length > 0) {
		warnings.push(`omo-codex: migrated legacy configuration from ${result.migratedFrom.join(", ")}`)
	}
	for (const migration of result.results) {
		for (const diagnostic of migration.diagnostics) {
			warnings.push(`omo-codex: configuration migration: ${diagnostic}`)
		}
	}
	return warnings
}

function applicabilityWarnings(config: OmoConfig): readonly string[] {
	return config.codegraph?.watch_debounce_ms === undefined
		? []
		: ["codegraph.watch_debounce_ms is not supported for harness codex"]
}

function codexCodegraphConfig(value: OmoConfig["codegraph"]): CodexCodegraphConfig | undefined {
	if (value === undefined) return undefined
	return {
		auto_provision: value.auto_provision,
		daemon: value.daemon,
		enabled: value.enabled,
		telemetry: value.telemetry,
		...(value.excluded_roots === undefined ? {} : { excluded_roots: value.excluded_roots }),
		...(value.install_dir === undefined ? {} : { install_dir: value.install_dir }),
		...(value.session_start_cooldown_ms === undefined ? {} : { session_start_cooldown_ms: value.session_start_cooldown_ms }),
		...(value.watch_debounce_ms === undefined ? {} : { watch_debounce_ms: value.watch_debounce_ms }),
	}
}

export function getCodexOmoConfig(options: CodexOmoConfigOptions = {}): CodexOmoConfig {
	const env = options.env ?? process.env
	const homeDir = resolveHomeDir(options)
	const environment = environmentWithHome(env, homeDir)
	const migration = runCodexStartupMigration({
		cwd: options.cwd ?? process.cwd(),
		environment,
		env: migrationEnvironment(homeDir, environment),
		...(options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem }),
		...(options.platform === undefined ? {} : { platform: options.platform }),
	})
	const result = loadOmoConfig({
		...(options.cwd === undefined ? {} : { cwd: options.cwd }),
		env: environment,
		...(options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem }),
		harness: "codex",
		...(options.platform === undefined ? {} : { platform: options.platform }),
		...(options.profile === undefined ? {} : { profile: options.profile }),
	})
	const trustedConfig = loadOmoConfig({
		cwd: homeDir,
		env: environment,
		...(options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem }),
		harness: "codex",
		...(options.platform === undefined ? {} : { platform: options.platform }),
		...(options.profile === undefined ? {} : { profile: options.profile }),
	})
	const envWarnings: string[] = []
	const config = OmoConfigSchema.parse(mergeOmoConfigRecords(result.config, envOverrides(env, envWarnings)))
	const trustedCodegraphInstallDir = trustedConfig.config.codegraph?.install_dir
	const { codegraph, ...resolvedConfig } = config
	const codexCodegraph = codexCodegraphConfig(codegraph)

	return {
		...resolvedConfig,
		...(codexCodegraph === undefined ? {} : { codegraph: codexCodegraph }),
		sources: result.sources,
		...(trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir }),
		warnings: [
			...migrationWarnings(migration),
			...result.diagnostics.map((diagnostic) => diagnostic.message),
			...envWarnings,
			...applicabilityWarnings(config),
		],
	}
}
