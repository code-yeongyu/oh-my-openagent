import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	cwd as processCwd,
	env as processEnv,
	stderr as processStderr,
	stdin as processStdin,
	stdout as processStdout,
} from "node:process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { buildCodegraphChildEnv, buildCodegraphEnv } from "../../../../../utils/src/codegraph/env.ts";
import { buildCodegraphInitGuidanceForToolResult } from "../../../../../utils/src/codegraph/guidance.ts";
import { resolveCodegraphCommand } from "../../../../../utils/src/codegraph/resolve.ts";
import { shouldExcludeCodegraphProject } from "../../../../../utils/src/codegraph/workspace.ts";
import { getCodexOmoConfig } from "../../../shared/src/config-loader.ts";
import { pruneCodegraphProjectStoresBestEffort } from "./cache-gc.js";
import { sweepCodegraphZombiesBestEffort } from "./hook-sweep.js";
import { resolveCodegraphCommandInvocation, SESSION_START_CWD_ENV } from "./session-start-worker.js";
import type {
	HookStdout,
	PostToolUseHookOptions,
	PostToolUseHookResult,
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
	PostToolUseHookOptions,
	PostToolUseHookResult,
	SessionStartAction,
	SessionStartHookOptions,
	SessionStartHookResult,
	SessionStartWorkerOptions,
	WorkerAction,
	WorkerSpawnInvocation,
} from "./hook-types.js";
export { resolveCodegraphCommandInvocation, runCodegraphSessionStartWorker } from "./session-start-worker.js";

export const CODEGRAPH_SESSION_START_NOTICE = "LazyCodex CodeGraph bootstrap scheduled in background";
const STATUS_PROBE_TIMEOUT_MS = 2_000;

export async function runCodegraphSessionStartHook(options: SessionStartHookOptions = {}): Promise<number> {
	return (await executeCodegraphSessionStartHook(options)).exitCode;
}

export async function runCodegraphPostToolUseHookCli(options: PostToolUseHookOptions = {}): Promise<number> {
	return (await executeCodegraphPostToolUseHook(options)).exitCode;
}

export async function executeCodegraphSessionStartHook(options: SessionStartHookOptions = {}): Promise<SessionStartHookResult> {
	const env = options.env ?? processEnv;
	const input = await readHookInput(options.stdin ?? processStdin);
	const projectRoot = resolveProjectRoot(input, options.cwd ?? processCwd());
	const homeDir = resolveHomeDir(env);
	const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
	pruneCodegraphProjectStoresBestEffort(homeDir, { debugLog: writeDebugLog });
	await sweepCodegraphZombiesBestEffort({
		env,
		homeDir,
		...(config.trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir: config.trustedCodegraphInstallDir }),
		log: writeDebugLog,
	}, options.sweepZombies);

	if (config.codegraph?.enabled === false) {
		return { action: "skipped-disabled", exitCode: 0 };
	}
	const excludedRoots = config.codegraph?.excluded_roots;
	const exclusion = shouldExcludeCodegraphProject(projectRoot, {
		homeDir,
		...(excludedRoots === undefined ? {} : { excludedRoots }),
	});
	if (exclusion.excluded) {
		return { action: "skipped-excluded", exitCode: 0 };
	}

	const isInitialized = await (options.statusProbe ?? isCodegraphProjectInitialized)({
		daemon: config.codegraph?.daemon === true,
		env,
		homeDir,
		projectRoot,
		...(config.trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir: config.trustedCodegraphInstallDir }),
	});
	if (isInitialized) {
		return { action: "skipped-initialized", exitCode: 0 };
	}

	(options.spawnWorker ?? spawnDetachedWorker)({
		args: [options.workerCliPath ?? defaultWorkerCliPath(), "hook", "session-start-worker"],
		command: process.execPath,
		env: buildCodegraphChildEnv({
			ambientEnv: env,
			codegraphEnv: { [SESSION_START_CWD_ENV]: projectRoot },
			runtimeEnv: env,
		}),
	});
	writeHookJson(options.stdout ?? processStdout);
	return { action: "spawned", exitCode: 0 };
}

async function isCodegraphProjectInitialized(options: {
	readonly daemon: boolean;
	readonly env: Record<string, string | undefined>;
	readonly homeDir: string;
	readonly projectRoot: string;
	readonly trustedCodegraphInstallDir?: string;
}): Promise<boolean> {
	const resolved = resolveCodegraphCommand({
		env: options.env,
		homeDir: options.homeDir,
		provisioned: () => provisionedBinFromInstallDir(options.trustedCodegraphInstallDir),
	});
	if (!resolved.exists) return false;

	const invocation = resolveCodegraphCommandInvocation(resolved.command, [...resolved.argsPrefix, "status", "--json"]);
	const codegraphEnv = {
		...buildCodegraphEnv({ daemon: options.daemon, homeDir: options.homeDir }),
		...(options.trustedCodegraphInstallDir === undefined ? {} : { CODEGRAPH_INSTALL_DIR: options.trustedCodegraphInstallDir }),
	};
	const status = await runStatusProbe(
		options.projectRoot,
		invocation.command,
		invocation.args,
		buildCodegraphChildEnv({ ambientEnv: options.env, codegraphEnv, runtimeEnv: options.env }),
	);
	if (status.exitCode !== 0 || status.timedOut) return false;
	return codegraphStatusSaysInitialized(status.stdout);
}

function runStatusProbe(
	projectRoot: string,
	command: string,
	args: readonly string[],
	env: Record<string, string>,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly timedOut: boolean }> {
	return new Promise((resolveProbe) => {
		execFile(
			command,
			[...args],
			{
				cwd: projectRoot,
				encoding: "utf8",
				env,
				maxBuffer: 1024 * 1024,
				timeout: STATUS_PROBE_TIMEOUT_MS,
				windowsHide: true,
			},
			(error, stdout) => {
				if (error === null) {
					resolveProbe({ exitCode: 0, stdout: toOutputText(stdout), timedOut: false });
					return;
				}
				resolveProbe({ exitCode: resolveExitCode(error), stdout: toOutputText(stdout), timedOut: error.killed === true });
			},
		);
	});
}

function codegraphStatusSaysInitialized(stdout: string): boolean {
	const parsed = parseJson(stdout);
	if (!isRecord(parsed)) return false;
	const initialized = parsed["initialized"] ?? parsed["isInitialized"] ?? parsed["ready"];
	if (typeof initialized === "boolean") return initialized;
	const status = parsed["status"];
	if (typeof status !== "string") return false;
	const normalized = status.toLowerCase();
	return (normalized.includes("initialized") || normalized.includes("ready")) && !normalized.includes("not initialized") && !normalized.includes("uninitialized");
}

function provisionedBinFromInstallDir(installDir: string | undefined): string | null {
	if (installDir === undefined) return null;
	return join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph");
}

export async function executeCodegraphPostToolUseHook(options: PostToolUseHookOptions = {}): Promise<PostToolUseHookResult> {
	const env = options.env ?? processEnv;
	const input = await readHookInput(options.stdin ?? processStdin);
	const output = runCodegraphPostToolUseHook(input, { homeDir: resolveHomeDir(env) });
	if (output.length === 0) return { action: "skipped", exitCode: 0 };

	(options.stdout ?? processStdout).write(output);
	return { action: "emitted-guidance", exitCode: 0 };
}

export function runCodegraphPostToolUseHook(input: unknown, options: { readonly homeDir?: string } = {}): string {
	const toolName = isRecord(input) ? input["tool_name"] : undefined;
	const cwd = isRecord(input) ? input["cwd"] : undefined;
	const toolOutput = isRecord(input) ? (input["tool_response"] ?? input["tool_output"] ?? input["response"]) : input;
	const guidance = buildCodegraphInitGuidanceForToolResult({ cwd, toolName, toolOutput }, options);
	if (guidance === null) return "";

	return `${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: guidance,
		},
	})}\n`;
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

function writeDebugLog(message: string): void {
	if (processEnv["OMO_CODEGRAPH_DEBUG"] !== "1") return;
	processStderr.write(`${message}\n`);
}

function spawnDetachedWorker(invocation: WorkerSpawnInvocation): void {
	const child = spawn(invocation.command, [...invocation.args], { detached: true, env: invocation.env, stdio: "ignore" });
	child.unref();
}

function resolveHomeDir(env: Record<string, string | undefined>): string {
	return env["HOME"] ?? env["USERPROFILE"] ?? homedir();
}

function resolveExitCode(error: Error): number {
	if ("code" in error && typeof error.code === "number") return error.code;
	return 1;
}

function toOutputText(value: string | Buffer): string {
	return Buffer.isBuffer(value) ? value.toString("utf8") : value;
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
