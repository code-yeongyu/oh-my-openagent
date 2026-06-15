import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd as processCwd, env as processEnv, stderr as processStderr, stdin as processStdin, stdout as processStdout } from "node:process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { getCodexOmoConfig, type CodexOmoConfig as SharedCodexOmoConfig } from "../../../shared/src/config-loader.ts";
import { buildCodegraphEnv } from "../../../../../utils/src/codegraph/env.ts";
import {
	ensureCodegraphProvisioned,
	type CodegraphProvisionResult as SharedCodegraphProvisionResult,
} from "../../../../../utils/src/codegraph/provision.ts";
import {
	resolveCodegraphCommand,
	type CodegraphCommandResolution,
	type ResolveCodegraphCommandOptions,
} from "../../../../../utils/src/codegraph/resolve.ts";
import {
	ensureCodegraphGitignored,
	prepareCodegraphWorkspace,
	type CodegraphWorkspacePreparation as SharedCodegraphWorkspacePreparation,
} from "../../../../../utils/src/codegraph/workspace.ts";
import type { CodegraphConfig as SharedCodegraphConfig } from "../../../../../utils/src/omo-config.ts";

export const CODEGRAPH_SESSION_START_NOTICE = "LazyCodex CodeGraph bootstrap scheduled in background";

export type SessionStartAction = "skipped-disabled" | "spawned";
export type WorkerAction = "failed" | "initialized" | "skipped-disabled" | "skipped-status" | "skipped-unavailable" | "synced";

export interface WorkerSpawnInvocation {
	readonly args: readonly string[];
	readonly command: string;
	readonly env: Record<string, string | undefined>;
}

export interface HookStdout {
	readonly write: (chunk: string) => void;
}

export interface SessionStartHookResult {
	readonly action: SessionStartAction;
	readonly exitCode: 0;
}

export interface CodegraphCommandResult {
	readonly exitCode: number;
	readonly stderr?: string;
	readonly stdout: string;
	readonly timedOut: boolean;
}

export type CodegraphConfig = Partial<SharedCodegraphConfig>;
export type CodexOmoConfig = SharedCodexOmoConfig;
export type OmoConfigSource = CodexOmoConfig["sources"][number];
export type CodegraphProvisionResult = SharedCodegraphProvisionResult;
export type CodegraphWorkspacePreparation = SharedCodegraphWorkspacePreparation;

export interface CodegraphSessionStartOutcome {
	readonly action: WorkerAction;
	readonly error?: string;
	readonly exitCode?: number;
	readonly projectRoot?: string;
	readonly source?: CodegraphCommandResolution["source"];
	readonly timedOut?: boolean;
}

export interface CodegraphSessionStartDeps {
	readonly ensureGitignored: (projectRoot: string) => boolean;
	readonly ensureProvisioned: (options: { readonly installDir?: string; readonly lockDir: string; readonly version: "1.0.1" }) => Promise<CodegraphProvisionResult>;
	readonly prepareWorkspace: (projectRoot: string, options: { readonly homeDir: string }) => CodegraphWorkspacePreparation;
	readonly resolveCommand: (options?: ResolveCodegraphCommandOptions) => CodegraphCommandResolution;
	readonly runCommand: (
		projectRoot: string,
		command: string,
		args: readonly string[],
		options: { readonly env: Record<string, string>; readonly timeoutMs: number },
	) => Promise<CodegraphCommandResult>;
}

export interface SessionStartHookOptions {
	readonly argv?: readonly string[];
	readonly config?: CodexOmoConfig;
	readonly cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly spawnWorker?: (invocation: WorkerSpawnInvocation) => void;
	readonly stdin?: Readable & { readonly isTTY?: boolean };
	readonly stdout?: HookStdout;
	readonly workerCliPath?: string;
}

export interface SessionStartWorkerOptions {
	readonly config?: CodexOmoConfig;
	readonly cwd?: string;
	readonly deps?: Partial<CodegraphSessionStartDeps>;
	readonly env?: Record<string, string | undefined>;
	readonly logOutcome?: (outcome: CodegraphSessionStartOutcome) => void;
}

const CODEGRAPH_VERSION = "1.0.1";
const COMMAND_TIMEOUT_MS = 60_000;
const SESSION_START_CWD_ENV = "OMO_CODEGRAPH_SESSION_START_CWD";

const defaultDeps: CodegraphSessionStartDeps = {
	ensureGitignored: ensureCodegraphGitignored,
	ensureProvisioned: ensureCodegraphProvisioned,
	prepareWorkspace: prepareCodegraphWorkspace,
	resolveCommand: resolveCodegraphCommand,
	runCommand: runCodegraphCommand,
};

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
		writeHookJson(options.stdout ?? processStdout, "skipped-disabled");
		return { action: "skipped-disabled", exitCode: 0 };
	}

	(options.spawnWorker ?? spawnDetachedWorker)({
		args: [options.workerCliPath ?? defaultWorkerCliPath(), "hook", "session-start-worker"],
		command: process.execPath,
		env: { ...env, [SESSION_START_CWD_ENV]: projectRoot },
	});
	writeHookJson(options.stdout ?? processStdout, "spawned");
	return { action: "spawned", exitCode: 0 };
}

export async function runCodegraphSessionStartWorker(options: SessionStartWorkerOptions = {}): Promise<{ readonly action: WorkerAction }> {
	const env = options.env ?? processEnv;
	const homeDir = resolveHomeDir(env);
	const projectRoot = options.cwd ?? env[SESSION_START_CWD_ENV] ?? processCwd();
	const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
	const logOutcome = options.logOutcome ?? ((outcome) => appendOutcome(homeDir, outcome));

	if (config.codegraph?.enabled === false) {
		return finish("skipped-disabled", { projectRoot }, logOutcome);
	}

	return runBootstrap(projectRoot, config.codegraph ?? {}, env, homeDir, { ...defaultDeps, ...options.deps }, logOutcome);
}

async function runBootstrap(
	projectRoot: string,
	config: CodegraphConfig,
	env: Record<string, string | undefined>,
	homeDir: string,
	deps: CodegraphSessionStartDeps,
	logOutcome: (outcome: CodegraphSessionStartOutcome) => void,
): Promise<{ readonly action: WorkerAction }> {
	try {
		deps.prepareWorkspace(projectRoot, { homeDir });
		deps.ensureGitignored(projectRoot);
		const command = await resolveOrProvisionCommand(deps, config, env, homeDir);
		if (command.kind === "unavailable") {
			return finish("skipped-unavailable", { error: command.error, projectRoot, source: command.source }, logOutcome);
		}

		const codegraphEnv = config.install_dir === undefined ? buildCodegraphEnv({ homeDir }) : { ...buildCodegraphEnv({ homeDir }), CODEGRAPH_INSTALL_DIR: config.install_dir };
		const status = await deps.runCommand(projectRoot, command.resolution.command, [...command.resolution.argsPrefix, "status", "--json"], { env: codegraphEnv, timeoutMs: COMMAND_TIMEOUT_MS });
		const decision = decideStartupAction(status);
		if (decision.kind === "skip") return finish("skipped-status", { error: decision.reason, projectRoot }, logOutcome);

		const actionArgs = command.resolution.argsPrefix.concat(decision.kind === "init" ? ["init"] : ["sync"]);
		const action = await deps.runCommand(projectRoot, command.resolution.command, actionArgs, { env: codegraphEnv, timeoutMs: COMMAND_TIMEOUT_MS });
		return finish(decision.kind === "init" ? "initialized" : "synced", { exitCode: action.exitCode, projectRoot, source: command.resolution.source, timedOut: action.timedOut }, logOutcome);
	} catch (error) {
		return finish("failed", { error: error instanceof Error ? error.message : String(error), projectRoot }, logOutcome);
	}
}

function finish(action: WorkerAction, detail: Omit<CodegraphSessionStartOutcome, "action">, logOutcome: (outcome: CodegraphSessionStartOutcome) => void): { readonly action: WorkerAction } {
	safeLogOutcome(logOutcome, { ...detail, action });
	return { action };
}

type ResolutionResult =
	| { readonly kind: "resolved"; readonly resolution: CodegraphCommandResolution }
	| { readonly error: string; readonly kind: "unavailable"; readonly projectRoot?: string; readonly source: CodegraphCommandResolution["source"] };

async function resolveOrProvisionCommand(deps: CodegraphSessionStartDeps, config: CodegraphConfig, env: Record<string, string | undefined>, homeDir: string): Promise<ResolutionResult> {
	const resolved = deps.resolveCommand({ env, homeDir, provisioned: () => provisionedBinFromInstallDir(config.install_dir) });
	if (resolved.exists) return { kind: "resolved", resolution: resolved };
	if (config.auto_provision === false) return { error: "codegraph binary unavailable and auto_provision is disabled", kind: "unavailable", source: resolved.source };

	const installDir = config.install_dir ?? join(homeDir, ".omo", "codegraph");
	const provisioned = await deps.ensureProvisioned({ installDir, lockDir: join(installDir, "locks"), version: CODEGRAPH_VERSION });
	if (!provisioned.provisioned || provisioned.binPath === undefined) {
		return { error: provisioned.error ?? "provisioning did not produce a binary", kind: "unavailable", source: resolved.source };
	}
	return { kind: "resolved", resolution: { argsPrefix: [], command: provisioned.binPath, exists: true, source: "provisioned" } };
}

function decideStartupAction(status: CodegraphCommandResult): { readonly kind: "init" } | { readonly kind: "skip"; readonly reason: string } | { readonly kind: "sync" } {
	if (status.timedOut) return { kind: "skip", reason: "status timed out" };
	const text = `${status.stdout}\n${status.stderr ?? ""}`.toLowerCase();
	if (text.includes("not initialized") || text.includes("uninitialized")) return { kind: "init" };
	const initialized = jsonSaysInitialized(parseJson(status.stdout));
	if (initialized === false) return { kind: "init" };
	if (initialized === true) return { kind: "sync" };
	if (status.exitCode !== 0) return { kind: "skip", reason: `status exited ${status.exitCode}` };
	return { kind: "sync" };
}

function jsonSaysInitialized(value: unknown): boolean | undefined {
	if (!isRecord(value)) return undefined;
	const initialized = value["initialized"] ?? value["isInitialized"] ?? value["ready"];
	if (typeof initialized === "boolean") return initialized;
	const status = value["status"];
	if (typeof status !== "string") return undefined;
	const normalized = status.toLowerCase();
	if (normalized.includes("not initialized") || normalized.includes("uninitialized")) return false;
	if (normalized.includes("initialized") || normalized.includes("ready")) return true;
	return undefined;
}

async function runCodegraphCommand(projectRoot: string, command: string, args: readonly string[], options: { readonly env: Record<string, string>; readonly timeoutMs: number }): Promise<CodegraphCommandResult> {
	return new Promise((resolvePromise) => {
		execFile(command, [...args], { cwd: projectRoot, encoding: "utf8", env: { ...process.env, ...options.env }, maxBuffer: 1024 * 1024, timeout: options.timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
			if (error === null) {
				resolvePromise({ exitCode: 0, stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: false });
				return;
			}
			resolvePromise({ exitCode: resolveExitCode(error), stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: error.killed === true });
		});
	});
}

function writeHookJson(stdout: HookStdout, action: SessionStartAction): void {
	const output = action === "spawned"
		? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: CODEGRAPH_SESSION_START_NOTICE }, codegraph: { action } }
		: { hookSpecificOutput: { hookEventName: "SessionStart" }, codegraph: { action } };
	stdout.write(`${JSON.stringify(output)}\n`);
}

function spawnDetachedWorker(invocation: WorkerSpawnInvocation): void {
	const child = spawn(invocation.command, [...invocation.args], { detached: true, env: invocation.env, stdio: "ignore" });
	child.unref();
}

function appendOutcome(homeDir: string, outcome: CodegraphSessionStartOutcome): void {
	const logDir = join(homeDir, ".omo", "codegraph");
	mkdirSync(logDir, { recursive: true });
	appendFileSync(join(logDir, "session-start.jsonl"), `${JSON.stringify({ ...outcome, timestamp: new Date().toISOString() })}\n`);
}

function safeLogOutcome(logOutcome: (outcome: CodegraphSessionStartOutcome) => void, outcome: CodegraphSessionStartOutcome): void {
	try {
		logOutcome(outcome);
	} catch (error) {
		if (error instanceof Error) processStderr.write(`[codegraph-session-start] failed to write outcome: ${error.message}\n`);
		else throw error;
	}
}

function provisionedBinFromInstallDir(installDir: string | undefined): string | null {
	if (installDir === undefined) return null;
	const candidate = join(installDir, "bin", process.platform === "win32" ? "codegraph.exe" : "codegraph");
	return existsSync(candidate) ? candidate : null;
}

function resolveExitCode(error: Error): number {
	if ("code" in error && typeof error.code === "number") return error.code;
	return 1;
}

function toOutputText(value: string | Buffer): string {
	return Buffer.isBuffer(value) ? value.toString("utf8") : value;
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
