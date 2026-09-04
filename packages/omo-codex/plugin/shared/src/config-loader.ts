import { homedir } from "node:os"

import {
	loadOmoConfig,
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

export type CodexOmoConfig = OmoConfig & {
	readonly sources: readonly OmoConfigSource[]
	readonly warnings: readonly string[]
}

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
	return {
		...result.config,
		sources: result.sources,
		warnings: [
			...migrationWarnings(migration),
			...result.diagnostics.map((diagnostic) => diagnostic.message),
		],
	}
}
