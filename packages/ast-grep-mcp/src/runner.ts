import { existsSync } from "node:fs"
import {
	DEFAULT_TIMEOUT_MS,
	runSg as runSgCore,
	type SgResult,
	type SgRunArgs,
	type SpawnOptions,
	type SpawnResult,
} from "@oh-my-opencode/ast-grep-core"
import { spawn } from "./bun-spawn-shim"
import {
	ensureCliAvailable,
	getAstGrepPath,
	isCliAvailable,
	startBackgroundInit,
} from "./cli-binary-path-resolution"
import { getSgCliPath } from "./constants"
import { collectProcessOutputWithTimeout } from "./process-output-timeout"

export { ensureCliAvailable, getAstGrepPath, isCliAvailable, startBackgroundInit }

export type RunOptions = SgRunArgs

export async function runSg(options: RunOptions): Promise<SgResult> {
	return runSgCore(options, {
		resolveBinary: resolveBinaryPath,
		spawnProcess,
	})
}

async function resolveBinaryPath(): Promise<string> {
	const cliPath = getSgCliPath()
	if (cliPath && existsSync(cliPath)) {
		return cliPath
	}

	const resolvedPath = await getAstGrepPath()
	if (!resolvedPath) {
		const noEntryError = new Error("ENOENT: ast-grep binary not found")
		Reflect.set(noEntryError, "code", "ENOENT")
		throw noEntryError
	}
  return resolvedPath
}

async function spawnProcess(
	binary: string,
	args: readonly string[],
	options?: SpawnOptions,
): Promise<SpawnResult> {
	const proc = spawn([binary, ...args], {
		cwd: options?.cwd,
		stdout: options?.stdout ?? "pipe",
		stderr: options?.stderr ?? "pipe",
	})

	return collectProcessOutputWithTimeout(proc, DEFAULT_TIMEOUT_MS)
}
