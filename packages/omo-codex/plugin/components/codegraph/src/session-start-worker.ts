import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd as processCwd, env as processEnv, stderr as processStderr } from "node:process";

import { getCodexOmoConfig } from "../../../shared/src/config-loader.ts";
import { buildCodegraphEnv } from "../../../../../utils/src/codegraph/env.ts";
import { ensureCodegraphProvisioned } from "../../../../../utils/src/codegraph/provision.ts";
import {
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

const CODEGRAPH_VERSION = "1.0.1";
const COMMAND_TIMEOUT_MS = 60_000;

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
		const command = await resolveOrProvisionCommand(deps, config, env, homeDir);
		if (command.kind === "unavailable") {
			return finish("skipped-unavailable", { error: command.error, projectRoot, source: command.source }, logOutcome);
		}

		deps.prepareWorkspace(projectRoot, { homeDir });
		deps.ensureGitignored(projectRoot);
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
