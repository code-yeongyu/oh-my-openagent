import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { cwd as processCwd, env as processEnv, execPath as processExecPath, stderr as processStderr } from "node:process";

import { getCodexOmoConfig } from "../../../shared/src/config-loader.ts";
import { buildCodegraphChildEnv, buildCodegraphEnv } from "../../../../../utils/src/codegraph/env.ts";
import { CODEGRAPH_PINNED_VERSION } from "../../../../../utils/src/codegraph/manifest.ts";
import { evaluateCodegraphNodeSupport, type CodegraphNodeSupport } from "../../../../../utils/src/codegraph/node-support.ts";
import { ensureCodegraphProvisioned } from "../../../../../utils/src/codegraph/provision.ts";
import {
	codegraphCommandRequiresSupportedLocalNode,
	resolveCodegraphCommand,
	type CodegraphCommandResolution,
} from "../../../../../utils/src/codegraph/resolve.ts";
import { ensureCodegraphGitignored, prepareCodegraphWorkspace } from "../../../../../utils/src/codegraph/workspace.ts";
import type {
	CodegraphCommandResult,
	CodegraphConfig,
	CodegraphSessionStartDeps,
	CodegraphSessionStartOutcome,
	SessionStartWorkerOptions,
	WorkerAction,
} from "./hook-types.js";

export const SESSION_START_CWD_ENV = "OMO_CODEGRAPH_SESSION_START_CWD";

const CODEGRAPH_VERSION = CODEGRAPH_PINNED_VERSION;
const COMMAND_TIMEOUT_MS = 60_000;
const WINDOWS_CMD_EXTENSIONS = new Set([".bat", ".cmd"]);
const WINDOWS_NODE_SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);
type CodegraphBootstrapConfig = CodegraphConfig & {
	readonly trustedCodegraphInstallDir?: string;
};

const defaultDeps: CodegraphSessionStartDeps = {
	ensureGitignored: ensureCodegraphGitignored,
	ensureProvisioned: ensureCodegraphProvisioned,
	prepareWorkspace: prepareCodegraphWorkspace,
	resolveCommand: resolveCodegraphCommand,
	runCommand: runCodegraphCommand,
};

export async function runCodegraphSessionStartWorker(options: SessionStartWorkerOptions = {}): Promise<{ readonly action: WorkerAction }> {
	const env = options.env ?? processEnv;
	const homeDir = resolveHomeDir(env);
	const projectRoot = options.cwd ?? env[SESSION_START_CWD_ENV] ?? processCwd();
	const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
	const logOutcome = options.logOutcome ?? ((outcome) => appendOutcome(homeDir, outcome));

	if (config.codegraph?.enabled === false) {
		return finish("skipped-disabled", { projectRoot }, logOutcome);
	}

	const nodeSupport = evaluateCodegraphNodeSupport({ env, nodeVersion: options.nodeVersion });
	const bootstrapConfig: CodegraphBootstrapConfig = {
		...(config.codegraph ?? {}),
		...(config.trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir: config.trustedCodegraphInstallDir }),
	};
	return runBootstrap(projectRoot, bootstrapConfig, env, homeDir, nodeSupport, { ...defaultDeps, ...options.deps }, logOutcome);
}

async function runBootstrap(
	projectRoot: string,
	config: CodegraphBootstrapConfig,
	env: Record<string, string | undefined>,
	homeDir: string,
	nodeSupport: CodegraphNodeSupport,
	deps: CodegraphSessionStartDeps,
	logOutcome: (outcome: CodegraphSessionStartOutcome) => void,
): Promise<{ readonly action: WorkerAction }> {
	try {
		const command = await resolveOrProvisionCommand(deps, config, env, homeDir, nodeSupport);
		if (command.kind === "unavailable") {
			return finish("skipped-unavailable", { error: command.error, projectRoot, source: command.source }, logOutcome);
		}
		if (command.kind === "unsupported-node") {
			return finish("skipped-unsupported-node", { projectRoot }, logOutcome);
		}

		deps.prepareWorkspace(projectRoot, { homeDir });
		deps.ensureGitignored(projectRoot);
		const codegraphEnv = codegraphEnvForConfig(config, homeDir);
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
	| { readonly kind: "unsupported-node" }
	| { readonly error: string; readonly kind: "unavailable"; readonly projectRoot?: string; readonly source: CodegraphCommandResolution["source"] };

async function resolveOrProvisionCommand(
	deps: CodegraphSessionStartDeps,
	config: CodegraphBootstrapConfig,
	env: Record<string, string | undefined>,
	homeDir: string,
	nodeSupport: CodegraphNodeSupport,
): Promise<ResolutionResult> {
	const trustedInstallDir = config.trustedCodegraphInstallDir;
	const resolved = deps.resolveCommand({ env, homeDir, provisioned: () => provisionedBinFromInstallDir(trustedInstallDir) });
	if (resolved.exists && canUseResolvedCommand(resolved, nodeSupport)) {
		return { kind: "resolved", resolution: resolved };
	}
	if (resolved.exists && config.auto_provision === false) return { kind: "unsupported-node" };
	if (config.auto_provision === false) return { error: "codegraph binary unavailable and auto_provision is disabled", kind: "unavailable", source: resolved.source };

	const installDir = trustedInstallDir ?? join(homeDir, ".omo", "codegraph");
	const provisioned = await deps.ensureProvisioned({ installDir, lockDir: join(installDir, ".locks"), version: CODEGRAPH_VERSION });
	if (!provisioned.provisioned || provisioned.binPath === undefined) {
		return { error: provisioned.error ?? "provisioning did not produce a binary", kind: "unavailable", source: resolved.source };
	}
	return { kind: "resolved", resolution: { argsPrefix: [], command: provisioned.binPath, exists: true, source: "provisioned" } };
}

function codegraphEnvForConfig(config: CodegraphBootstrapConfig, homeDir: string): Record<string, string> {
	// The detached indexing worker must NEVER engage the upstream daemon, even
	// when the user opted into daemon mode for interactive MCP sessions: a
	// daemon-backed init/sync would outlive and race the worker's lifecycle.
	const env = buildCodegraphEnv({ daemon: false, homeDir });
	return config.trustedCodegraphInstallDir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: config.trustedCodegraphInstallDir };
}

function canUseResolvedCommand(resolved: CodegraphCommandResolution, nodeSupport: CodegraphNodeSupport): boolean {
	return !codegraphCommandRequiresSupportedLocalNode(resolved) || nodeSupport.supported;
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
	const invocation = resolveCodegraphCommandInvocation(command, args);
	return new Promise((resolvePromise) => {
		execFile(invocation.command, [...invocation.args], { cwd: projectRoot, encoding: "utf8", env: buildCodegraphChildEnv({ ambientEnv: processEnv, codegraphEnv: options.env }), maxBuffer: 1024 * 1024, timeout: options.timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
			if (error === null) {
				resolvePromise({ exitCode: 0, stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: false });
				return;
			}
			resolvePromise({ exitCode: resolveExitCode(error), stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: error.killed === true });
		});
	});
}

export function resolveCodegraphCommandInvocation(
	command: string,
	args: readonly string[],
	platform: NodeJS.Platform = process.platform,
): { readonly args: readonly string[]; readonly command: string } {
	if (platform !== "win32") return { args: [...args], command };
	const extension = extname(command).toLowerCase();
	if (WINDOWS_NODE_SCRIPT_EXTENSIONS.has(extension)) return { args: [command, ...args], command: processExecPath };
	if (!WINDOWS_CMD_EXTENSIONS.has(extension)) return { args: [...args], command };
	return { args: ["/d", "/s", "/c", command, ...args], command: "cmd.exe" };
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
	const candidate = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph");
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
