import { existsSync } from "node:fs"
import { posix, win32 } from "node:path"

import {
	runMigrations,
	type LoadedMigrationSource,
	type MigrationBoundary,
	type MigrationClock,
	type MigrationEnvironment,
	type MigrationFileSystem,
	type MigrationPlan,
	type MigrationRunResult,
	type MigrationTransformResult,
} from "../../../../omo-config-core/src/index.ts"

const MIGRATION_ID = "2026-07-codex-config-jsonc"
const OMO_SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json"

type DiscoveryFileSystem = {
	readonly existsSync: (path: string) => boolean
}

type PathOperations = {
	readonly join: (...paths: string[]) => string
}

export type CodexConfigMigrationOptions = {
	readonly backupTimestamp?: string
	readonly clock?: MigrationClock
	readonly cwd: string
	readonly discoveryFileSystem?: DiscoveryFileSystem
	readonly env?: MigrationEnvironment
	readonly environment?: Readonly<Record<string, string | undefined>>
	readonly fileSystem?: MigrationFileSystem
	readonly homeDir?: string
	readonly isProcessAlive?: (pid: number) => boolean
	readonly onBoundary?: (boundary: MigrationBoundary) => void
	readonly pathOperations?: PathOperations
	readonly pid?: number
	readonly platform?: NodeJS.Platform
}

export type CodexConfigMigrationResult = {
	readonly error?: string
	readonly journalResumed: boolean
	readonly migratedFrom: readonly string[]
	readonly results: readonly MigrationRunResult[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordAt(value: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> | undefined {
	const candidate = value[key]
	return isRecord(candidate) ? candidate : undefined
}

function migrationHistory(sources: readonly LoadedMigrationSource[], configPath: string): Record<string, readonly string[]> {
	const history: string[] = []
	for (const source of sources) {
		if (!isRecord(source.value)) continue
		for (const key of ["_migrations", "appliedMigrations"]) {
			const values = source.value[key]
			if (!Array.isArray(values)) continue
			for (const value of values) {
				if (typeof value === "string" && !history.includes(value)) history.push(value)
			}
		}
	}
	return history.length === 0 ? {} : { [configPath]: history }
}

function transformConfigJsonc(configPath: string, sources: readonly LoadedMigrationSource[]): MigrationTransformResult {
	const config = sources.find((source) => source.path === configPath)
	const legacy = config === undefined || !isRecord(config.value) ? {} : config.value
	const omo = recordAt(legacy, "[omo]")
	const senpi = recordAt(legacy, "[senpi]")
	const history = migrationHistory(sources, configPath)
	return {
		diagnostics: omo !== undefined && senpi !== undefined
			? ["conflict: [senpi] legacy [omo] kept [senpi]"]
			: [],
		document: {
			$schema: OMO_SCHEMA_URL,
			...(recordAt(legacy, "codegraph") === undefined ? {} : { codegraph: recordAt(legacy, "codegraph") }),
			...(recordAt(legacy, "[opencode]") === undefined ? {} : { "[opencode]": recordAt(legacy, "[opencode]") }),
			...(recordAt(legacy, "[codex]") === undefined ? {} : { "[codex]": recordAt(legacy, "[codex]") }),
			...(senpi === undefined && omo === undefined ? {} : { "[senpi]": senpi ?? omo }),
			...(Object.keys(history).length === 0 ? {} : { legacy_migrations: history }),
		},
	}
}

function timestamp(value: string | undefined): string {
	return value ?? new Date().toISOString().replace(/[:.]/g, "-")
}

function sourceExists(options: CodexConfigMigrationOptions, path: string): boolean {
	return (options.discoveryFileSystem ?? options.fileSystem ?? { existsSync }).existsSync(path)
}

function migrationPlan(homeDir: string, options: CodexConfigMigrationOptions): MigrationPlan | undefined {
	const platform = options.platform ?? process.platform
	const paths = options.pathOperations ?? (platform === "win32" ? win32 : posix)
	const configPath = paths.join(homeDir, ".omo", "config.jsonc")
	const sidecarPath = `${configPath}.migrations.json`
	const sourcePaths = [configPath, sidecarPath].filter((path) => sourceExists(options, path))
	if (sourcePaths.length === 0) return undefined
	const backupRoot = paths.join(homeDir, ".omo", `migration-backup-${timestamp(options.backupTimestamp)}-opencode-config`, ".omo")
	return {
		id: MIGRATION_ID,
		sources: sourcePaths.map((path) => ({
			backupPath: paths.join(backupRoot, path === configPath ? "config.jsonc" : "config.jsonc.migrations.json"),
			path,
		})),
		targetPath: paths.join(homeDir, ".omo", "omo.jsonc"),
		transform: (sources) => transformConfigJsonc(configPath, sources),
	}
}

function migratedSources(results: readonly MigrationRunResult[]): readonly string[] {
	return [...new Set(results.flatMap((result) => result.status === "migrated"
		? result.preview?.backupMoves.map((move) => move.from) ?? []
		: []))].sort()
}

export function runCodexConfigMigration(options: CodexConfigMigrationOptions): CodexConfigMigrationResult {
	const environment = options.environment ?? process.env
	const homeDir = options.homeDir ?? environment["HOME"] ?? environment["USERPROFILE"]
	if (homeDir === undefined || homeDir.length === 0) {
		return { error: "Cannot migrate configuration because no home directory is available", journalResumed: false, migratedFrom: [], results: [] }
	}

	try {
		const batch = runMigrations({
			...(options.clock === undefined ? {} : { clock: options.clock }),
			discover: () => {
				const plan = migrationPlan(homeDir, options)
				return plan === undefined ? [] : [plan]
			},
			...(options.env === undefined ? { env: { HOME: homeDir } } : { env: options.env }),
			...(options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem }),
			...(options.isProcessAlive === undefined ? {} : { isProcessAlive: options.isProcessAlive }),
			...(options.onBoundary === undefined ? {} : { onBoundary: options.onBoundary }),
			...(options.pid === undefined ? {} : { pid: options.pid }),
		})
		return {
			...(batch.status === "locked" ? { error: "Configuration migration is already running" } : {}),
			journalResumed: batch.journalResumed,
			migratedFrom: migratedSources(batch.results),
			results: batch.results,
		}
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : String(error),
			journalResumed: false,
			migratedFrom: [],
			results: [],
		}
	}
}
