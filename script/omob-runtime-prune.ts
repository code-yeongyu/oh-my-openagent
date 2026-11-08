// script/omob-runtime-prune.ts
// Retires old omob dev runtimes under ~/.omo/binary-runtime. A compiled omob re-execs from its
// provisioned runtime dir and reads plugin assets (skills, personas, sidecars) lazily, so a
// runtime that any live process still executes from must survive every prune.

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, sep } from "node:path"

export interface PruneEntry {
	readonly name: string
	readonly mtimeMs: number
}

const OMOB_RUNTIME_PREFIX = "0.0.0-omob."

export function isOmobRuntimeDir(name: string): boolean {
	return name.startsWith(OMOB_RUNTIME_PREFIX)
}

/**
 * Prune plan for a build about to provision `currentVersion`: that version owns one of the
 * `keep` slots (whether or not its dir exists yet), so only `keep - 1` OTHER idle dev runtimes
 * survive. In-use runtimes are neither deleted nor charged to the budget. Release runtimes are
 * never touched.
 */
export function planRuntimePrune(entries: readonly PruneEntry[], keep: number, currentVersion: string, inUse: ReadonlySet<string> = new Set()): string[] {
	const idle = entries.filter((entry) => entry.name !== currentVersion && !inUse.has(entry.name))
	return selectPruneEntries(idle, Math.max(0, keep - 1))
}

/** Names of dev runtime dirs to delete: omob dirs beyond the newest `keep`. Release runtimes are never touched. */
export function selectPruneEntries(entries: readonly PruneEntry[], keep: number): string[] {
	const omob = entries.filter((entry) => isOmobRuntimeDir(entry.name))
	const sorted = omob.slice().sort((left, right) => right.mtimeMs - left.mtimeMs)
	return sorted.slice(Math.max(0, keep)).reverse().map((entry) => entry.name)
}

/** Runtime dir names whose provisioned executable is the image of a live process. */
export function runtimesInUse(runtimeRoot: string, names: readonly string[], processCommands: readonly string[]): ReadonlySet<string> {
	const inUse = new Set<string>()
	for (const name of names) {
		const executablePrefix = join(runtimeRoot, name) + sep
		if (processCommands.some((command) => command.startsWith(executablePrefix))) inUse.add(name)
	}
	return inUse
}

export class ProcessListUnavailableError extends Error {
	constructor(
		readonly command: string,
		readonly reason: string,
	) {
		super(`process list unavailable via ${command}: ${reason}`)
		this.name = "ProcessListUnavailableError"
	}
}

/** Command line of every live process, executable path first. */
export function listProcessCommands(platform: NodeJS.Platform = process.platform): readonly string[] {
	const command = platform === "win32" ? "powershell" : "ps"
	const args = platform === "win32" ? ["-NoProfile", "-Command", "Get-Process | ForEach-Object { $_.Path }"] : ["-axo", "command="]
	const result = spawnSync(command, args, { encoding: "utf8" })
	if (result.error !== undefined) throw new ProcessListUnavailableError(command, result.error.message)
	if (result.status !== 0) throw new ProcessListUnavailableError(command, `exit ${result.status ?? result.signal ?? "unknown"}`)
	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
}

export interface PruneRequest {
	readonly runtimeRoot: string
	readonly keep: number
	readonly currentVersion: string
	readonly processCommands?: readonly string[]
}

/**
 * Deletes idle dev runtimes beyond the budget and returns the in-use dev runtimes it kept.
 * When the process list cannot be read, nothing is deleted: pruning blind is how a running
 * session loses its plugin assets.
 */
export function pruneOmobRuntimes(request: PruneRequest): string[] {
	if (!existsSync(request.runtimeRoot)) return []
	const entries: PruneEntry[] = readdirSync(request.runtimeRoot).map((name) => ({
		name,
		mtimeMs: statSync(join(request.runtimeRoot, name)).mtimeMs,
	}))
	let processCommands: readonly string[]
	try {
		processCommands = request.processCommands ?? listProcessCommands()
	} catch (error) {
		if (!(error instanceof ProcessListUnavailableError)) throw error
		console.warn(`skipped dev runtime prune: ${error.message}`)
		return []
	}
	const inUse = runtimesInUse(
		request.runtimeRoot,
		entries.map((entry) => entry.name),
		processCommands,
	)
	for (const name of planRuntimePrune(entries, request.keep, request.currentVersion, inUse)) {
		rmSync(join(request.runtimeRoot, name), { recursive: true, force: true })
		console.log(`pruned dev runtime ${name}`)
	}
	const kept = [...inUse].filter(isOmobRuntimeDir).sort()
	for (const name of kept) console.log(`kept in-use dev runtime ${name}`)
	return kept
}
