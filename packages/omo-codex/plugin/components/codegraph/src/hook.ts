import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { cwd as processCwd, env as processEnv, stdin as processStdin, stdout as processStdout } from "node:process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { getCodexOmoConfig } from "../../../shared/src/config-loader.ts";
import { SESSION_START_CWD_ENV } from "./session-start-worker.js";
import type {
	HookStdout,
	SessionStartHookOptions,
	SessionStartHookResult,
	WorkerSpawnInvocation,
} from "./hook-types.js";

export type {
	CodegraphCommandResult,
	CodegraphConfig,
	CodegraphProvisionResult,
	CodegraphSessionStartDeps,
	CodegraphSessionStartOutcome,
	CodegraphWorkspacePreparation,
	CodexOmoConfig,
	HookStdout,
	OmoConfigSource,
	SessionStartAction,
	SessionStartHookOptions,
	SessionStartHookResult,
	SessionStartWorkerOptions,
	WorkerAction,
	WorkerSpawnInvocation,
} from "./hook-types.js";
export { resolveCodegraphCommandInvocation, runCodegraphSessionStartWorker } from "./session-start-worker.js";

export const CODEGRAPH_SESSION_START_NOTICE = "LazyCodex CodeGraph bootstrap scheduled in background";

export async function runCodegraphSessionStartHook(options: SessionStartHookOptions = {}): Promise<number> {
	return (await executeCodegraphSessionStartHook(options)).exitCode;
}

export async function executeCodegraphSessionStartHook(options: SessionStartHookOptions = {}): Promise<SessionStartHookResult> {
	const env = options.env ?? processEnv;
	const input = await readHookInput(options.stdin ?? processStdin);
	const projectRoot = resolveProjectRoot(input, options.cwd ?? processCwd());
	const homeDir = resolveHomeDir(env);
	const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });

	if (config.codegraph?.enabled === false) {
		return { action: "skipped-disabled", exitCode: 0 };
	}

	(options.spawnWorker ?? spawnDetachedWorker)({
		args: [options.workerCliPath ?? defaultWorkerCliPath(), "hook", "session-start-worker"],
		command: process.execPath,
		env: { ...env, [SESSION_START_CWD_ENV]: projectRoot },
	});
	writeHookJson(options.stdout ?? processStdout);
	return { action: "spawned", exitCode: 0 };
}

function writeHookJson(stdout: HookStdout): void {
	const output = {
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: CODEGRAPH_SESSION_START_NOTICE,
		},
	};
	stdout.write(`${JSON.stringify(output)}\n`);
}

function spawnDetachedWorker(invocation: WorkerSpawnInvocation): void {
	const child = spawn(invocation.command, [...invocation.args], { detached: true, env: invocation.env, stdio: "ignore" });
	child.unref();
}

function resolveHomeDir(env: Record<string, string | undefined>): string {
	return env["HOME"] ?? env["USERPROFILE"] ?? homedir();
}

function resolveProjectRoot(input: unknown, fallback: string): string {
	if (!isRecord(input)) return fallback;
	const cwd = input["cwd"];
	return typeof cwd === "string" && cwd.trim().length > 0 ? cwd : fallback;
}

async function readHookInput(stdin: Readable & { readonly isTTY?: boolean }): Promise<unknown> {
	if (stdin.isTTY === true) return undefined;
	let text = "";
	for await (const chunk of stdin) text += typeof chunk === "string" ? chunk : String(chunk);
	if (text.trim().length === 0) return undefined;
	return parseJson(text);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function defaultWorkerCliPath(): string {
	return fileURLToPath(import.meta.url);
}
