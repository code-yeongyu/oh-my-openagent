import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { DEFAULT_LOCK_STALE_MS } from "../../../scripts/auto-update-state.mjs";
import { resolveBootstrapLockPath, resolveBootstrapStatePath } from "./environment.ts";
import { readBootstrapState, readPluginVersion } from "./worker.ts";

export const BOOTSTRAP_RESTART_NOTICE =
	"LazyCodex bootstrap running in background — restart the session when it completes";

export type SessionStartAction =
	| "spawned"
	| "skip-completed"
	| "skip-locked"
	| "skip-missing-env"
	| "skip-version-unresolved";

export interface WorkerSpawnInvocation {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Record<string, string | undefined>;
}

export interface SessionStartHookOptions {
	readonly env: Record<string, string | undefined>;
	readonly stdin?: Readable & { readonly isTTY?: boolean };
	readonly now?: number;
	readonly spawnWorker?: (invocation: WorkerSpawnInvocation) => void;
	readonly workerCliPath?: string;
	readonly writeNotice?: (line: string) => void;
}

export interface SessionStartHookResult {
	readonly exitCode: 0;
	readonly action: SessionStartAction;
}

export async function runSessionStartHook(options: SessionStartHookOptions): Promise<number> {
	return (await executeSessionStartHook(options)).exitCode;
}

export async function executeSessionStartHook(options: SessionStartHookOptions): Promise<SessionStartHookResult> {
	if (options.stdin !== undefined) await drainStdin(options.stdin);
	const now = options.now ?? Date.now();
	const pluginRoot = options.env["PLUGIN_ROOT"]?.trim();
	const pluginData = options.env["PLUGIN_DATA"]?.trim();
	if (pluginRoot === undefined || pluginRoot.length === 0 || pluginData === undefined || pluginData.length === 0) {
		return { action: "skip-missing-env", exitCode: 0 };
	}

	const pluginVersion = await readPluginVersion(pluginRoot);
	if (pluginVersion === undefined) return { action: "skip-version-unresolved", exitCode: 0 };

	const state = await readBootstrapState(resolveBootstrapStatePath(pluginData));
	if (state.completedForVersion === pluginVersion) return { action: "skip-completed", exitCode: 0 };

	if (await isLockFresh(resolveBootstrapLockPath(pluginData), now)) return { action: "skip-locked", exitCode: 0 };

	const spawnWorker = options.spawnWorker ?? spawnDetachedWorker;
	spawnWorker({
		args: [options.workerCliPath ?? defaultWorkerCliPath(), "worker"],
		command: process.execPath,
		env: options.env,
	});
	const writeNotice = options.writeNotice ?? ((line: string) => process.stdout.write(`${line}\n`));
	writeNotice(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext: BOOTSTRAP_RESTART_NOTICE,
			},
		}),
	);
	return { action: "spawned", exitCode: 0 };
}

function spawnDetachedWorker(invocation: WorkerSpawnInvocation): void {
	const child = spawn(invocation.command, [...invocation.args], {
		detached: true,
		env: invocation.env,
		stdio: "ignore",
	});
	child.unref();
}

function defaultWorkerCliPath(): string {
	// In the esbuild bundle every module shares import.meta.url, so this
	// resolves to dist/cli.js — the file the detached worker must re-enter.
	return fileURLToPath(import.meta.url);
}

async function isLockFresh(lockPath: string, now: number): Promise<boolean> {
	try {
		const lockStat = await stat(lockPath);
		return now - lockStat.mtimeMs < DEFAULT_LOCK_STALE_MS;
	} catch {
		return false;
	}
}

async function drainStdin(stdin: NonNullable<SessionStartHookOptions["stdin"]>): Promise<void> {
	if (stdin.isTTY === true) return;
	for await (const chunk of stdin) {
		void chunk;
	}
}
