import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd as processCwd, env as processEnv, stderr as processStderr } from "node:process";

import { ensureCodegraphProjectReady, runCodegraphCommand } from "@oh-my-opencode/codegraph-mcp";
import { getCodexOmoConfig } from "../../../shared/src/config-loader.ts";
import { buildCodegraphEnv } from "../../../../../utils/src/codegraph/env.ts";
import { evaluateCodegraphNodeSupport, type CodegraphNodeSupport } from "../../../../../utils/src/codegraph/node-support.ts";
import { ensureCodegraphProvisioned } from "../../../../../utils/src/codegraph/provision.ts";
import {
	codegraphCommandRequiresSupportedLocalNode,
	resolveCodegraphCommand,
	type CodegraphCommandResolution,
} from "../../../../../utils/src/codegraph/resolve.ts";
import { CODEGRAPH_VERSION } from "../../../../../utils/src/codegraph/version.ts";
import type {
	CodegraphConfig,
	CodegraphSessionStartDeps,
	CodegraphSessionStartOutcome,
	SessionStartWorkerOptions,
	WorkerAction,
} from "./hook-types.js";
export { resolveCodegraphProcessInvocation as resolveCodegraphCommandInvocation } from "@oh-my-opencode/codegraph-mcp";

export const SESSION_START_CWD_ENV = "OMO_CODEGRAPH_SESSION_START_CWD";

type CodegraphBootstrapConfig = CodegraphConfig & {
	readonly trustedCodegraphInstallDir?: string;
};

const defaultDeps: CodegraphSessionStartDeps = {
	ensureProvisioned: ensureCodegraphProvisioned,
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
	if (config.codegraph?.auto_init === false && !codegraphStateExists(projectRoot)) {
		return finish("skipped-status", { error: "codegraph is not initialized and auto_init is disabled", projectRoot }, logOutcome);
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

		const codegraphEnv = codegraphEnvForConfig(config, homeDir);
		const readiness = await ensureCodegraphProjectReady(
			projectRoot,
			config.auto_init !== false,
			{
				command: { argsPrefix: command.resolution.argsPrefix, command: command.resolution.command },
				env: codegraphEnv,
				homeDir,
				run: deps.runCommand,
			},
		);
		if (readiness.action === "skipped") {
			return finish("skipped-status", { error: "codegraph is not initialized and auto_init is disabled", projectRoot }, logOutcome);
		}

		return finish(readiness.action, { exitCode: readiness.exitCode, projectRoot, source: command.resolution.source, timedOut: readiness.timedOut }, logOutcome);
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
	const env = buildCodegraphEnv({ homeDir });
	return config.trustedCodegraphInstallDir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: config.trustedCodegraphInstallDir };
}

function canUseResolvedCommand(resolved: CodegraphCommandResolution, nodeSupport: CodegraphNodeSupport): boolean {
	return !codegraphCommandRequiresSupportedLocalNode(resolved) || nodeSupport.supported;
}

function codegraphStateExists(projectRoot: string): boolean {
	return existsSync(join(projectRoot, ".codegraph"));
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

function resolveHomeDir(env: Record<string, string | undefined>): string {
	return env["HOME"] ?? env["USERPROFILE"] ?? homedir();
}
