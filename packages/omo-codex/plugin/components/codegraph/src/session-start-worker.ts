import { homedir } from "node:os";
import { cwd as processCwd, env as processEnv } from "node:process";

import { getCodexOmoConfig } from "../../../shared/src/config-loader.ts";
import { hasCodegraphManagedInstall, resolvePinnedCodegraphBin } from "../../../../../utils/src/codegraph/managed-runtime.ts";
import { evaluateCodegraphNodeSupport, type CodegraphNodeSupport } from "../../../../../utils/src/codegraph/node-support.ts";
import { ensureCodegraphProvisioned } from "../../../../../utils/src/codegraph/provision.ts";
import { resolveCodegraphCommand } from "../../../../../utils/src/codegraph/resolve.ts";
import { ensureCodegraphGitignored, prepareCodegraphWorkspace } from "../../../../../utils/src/codegraph/workspace.ts";
import type {
	CodegraphSessionStartDeps,
	CodegraphSessionStartOutcome,
	SessionStartWorkerOptions,
	WorkerAction,
} from "./hook-types.js";
import {
	resolveSessionStartCommand,
	runSessionStartCodegraphCommand,
	SESSION_START_COMMAND_TIMEOUT_MS,
	sessionStartCodegraphEnv,
	type CodegraphBootstrapConfig,
} from "./session-start-command.js";
import { DEFAULT_SESSION_START_COOLDOWN_MS } from "./session-start-cooldown.js";
import { releaseSessionStartLock, sessionStartLockIsOwned, type SessionStartLock } from "./session-start-lock.js";
import { appendSessionStartOutcome } from "./session-start-outcome.js";
import { resolveSessionStartStatePaths } from "./session-start-paths.js";
import { probeCodegraphProject, type CodegraphProjectState } from "./session-start-project.js";
import {
	finishWorkerFailure,
	finishWorkerInitialization,
	finishWorkerNeutral,
	finishWorkerProjectState,
	safeLogWorkerOutcome,
	type WorkerResultContext,
	type WorkerRunResult,
} from "./session-start-worker-result.js";

export const SESSION_START_CWD_ENV = "OMO_CODEGRAPH_SESSION_START_CWD";
export const SESSION_START_LOCK_TOKEN_ENV = "OMO_CODEGRAPH_SESSION_START_LOCK_TOKEN";

type WorkerContext = WorkerResultContext & {
	readonly config: CodegraphBootstrapConfig;
	readonly deps: CodegraphSessionStartDeps;
	readonly env: Record<string, string | undefined>;
	readonly probeProject: (projectRoot: string) => CodegraphProjectState;
};

const defaultDeps: CodegraphSessionStartDeps = {
	ensureGitignored: ensureCodegraphGitignored,
	ensureProvisioned: ensureCodegraphProvisioned,
	managedInstallExists: hasCodegraphManagedInstall,
	prepareWorkspace: prepareCodegraphWorkspace,
	resolveCommand: resolveCodegraphCommand,
	resolveManagedBin: resolvePinnedCodegraphBin,
	runCommand: runSessionStartCodegraphCommand,
};

export async function runCodegraphSessionStartWorker(options: SessionStartWorkerOptions = {}): Promise<{ readonly action: WorkerAction }> {
	const env = options.env ?? processEnv;
	const homeDir = resolveHomeDir(env);
	const projectRoot = options.cwd ?? env[SESSION_START_CWD_ENV] ?? processCwd();
	const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
	const lock = resolveWorkerLock(homeDir, projectRoot, env[SESSION_START_LOCK_TOKEN_ENV]);
	if (lock !== null && !sessionStartLockIsOwned(lock)) {
		const outcome = { action: "skipped-locked", projectRoot } satisfies CodegraphSessionStartOutcome;
		safeLogWorkerOutcome(options.logOutcome ?? ((value) => appendSessionStartOutcome(homeDir, value)), outcome);
		return { action: "skipped-locked" };
	}

	const customResolutionDeps = options.deps?.resolveCommand === undefined
		? {}
		: {
			managedInstallExists: options.deps.managedInstallExists ?? (() => false),
			resolveManagedBin: options.deps.resolveManagedBin ?? (() => null),
		};
	const context: WorkerContext = {
		baseCooldownMs: config.codegraph?.session_start_cooldown_ms ?? DEFAULT_SESSION_START_COOLDOWN_MS,
		config: {
			...(config.codegraph ?? {}),
			...(config.trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir: config.trustedCodegraphInstallDir }),
		},
		deps: { ...defaultDeps, ...customResolutionDeps, ...options.deps },
		env,
		homeDir,
		logOutcome: options.logOutcome ?? ((outcome) => appendSessionStartOutcome(homeDir, outcome)),
		nowMs: () => options.nowMs ?? Date.now(),
		probeProject: options.projectProbe ?? probeCodegraphProject,
		projectRoot,
	};

	let result: WorkerRunResult;
	if (config.codegraph?.enabled === false) {
		result = finishWorkerNeutral("skipped-disabled", { projectRoot }, context);
	} else {
		const nodeSupport = evaluateCodegraphNodeSupport({ env, nodeVersion: options.nodeVersion });
		result = await runBootstrap(context, nodeSupport);
	}
	if (lock !== null && result.releaseLock) releaseSessionStartLock(lock);
	return { action: result.action };
}

async function runBootstrap(context: WorkerContext, nodeSupport: CodegraphNodeSupport): Promise<WorkerRunResult> {
	try {
		const projectState = context.probeProject(context.projectRoot);
		const projectDecision = finishWorkerProjectState(projectState, context);
		if (projectDecision !== null) return projectDecision;

		const command = await resolveSessionStartCommand({
			config: context.config,
			deps: context.deps,
			env: context.env,
			homeDir: context.homeDir,
			nodeSupport,
		});
		if (command.kind === "unavailable") {
			return finishWorkerFailure("skipped-unavailable", "skipped-unavailable", {
				error: command.error,
				projectRoot: context.projectRoot,
				source: command.source,
			}, context);
		}
		if (command.kind === "unsupported-node") {
			return finishWorkerFailure("skipped-unsupported-node", "skipped-unsupported-node", { projectRoot: context.projectRoot }, context);
		}

		context.deps.prepareWorkspace(context.projectRoot, { homeDir: context.homeDir });
		context.deps.ensureGitignored(context.projectRoot);
		const preparedState = context.probeProject(context.projectRoot);
		const preparedDecision = finishWorkerProjectState(preparedState, context);
		if (preparedDecision !== null) return preparedDecision;

		const action = await context.deps.runCommand(
			context.projectRoot,
			command.resolution.command,
			[...command.resolution.argsPrefix, "init"],
			{ env: sessionStartCodegraphEnv(context.config, context.homeDir), timeoutMs: SESSION_START_COMMAND_TIMEOUT_MS },
		);
		if (action.timedOut) {
			return finishWorkerFailure("failed", "timeout", {
				error: "codegraph init timed out",
				exitCode: action.exitCode,
				projectRoot: context.projectRoot,
				source: command.resolution.source,
				timedOut: true,
			}, context);
		}
		if (action.exitCode !== 0) {
			return finishWorkerFailure("failed", "failed", {
				error: `codegraph init exited ${action.exitCode}`,
				exitCode: action.exitCode,
				projectRoot: context.projectRoot,
				source: command.resolution.source,
				timedOut: false,
			}, context);
		}
		return finishWorkerInitialization(context.probeProject(context.projectRoot), {
			exitCode: action.exitCode,
			source: command.resolution.source,
		}, context);
	} catch (error) {
		return finishWorkerFailure("failed", "failed", {
			error: error instanceof Error ? error.message : String(error),
			projectRoot: context.projectRoot,
		}, context);
	}
}

function resolveWorkerLock(homeDir: string, projectRoot: string, token: string | undefined): SessionStartLock | null {
	if (token === undefined || token.length === 0) return null;
	return { path: resolveSessionStartStatePaths(homeDir, projectRoot).lockPath, token };
}

function resolveHomeDir(env: Record<string, string | undefined>): string {
	return env["HOME"] ?? env["USERPROFILE"] ?? homedir();
}
