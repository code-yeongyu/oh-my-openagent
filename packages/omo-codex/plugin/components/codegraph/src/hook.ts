import {
	cwd as processCwd,
	env as processEnv,
	stderr as processStderr,
	stdin as processStdin,
	stdout as processStdout,
} from "node:process";
import { fileURLToPath } from "node:url";

import { buildCodegraphChildEnv } from "../../../../../utils/src/codegraph/env.ts";
import { shouldExcludeCodegraphProject } from "../../../../../utils/src/codegraph/workspace.ts";
import { getCodexOmoConfig } from "../../../shared/src/config-loader.ts";
import { pruneCodegraphProjectStoresBestEffort } from "./cache-gc.js";
import { readHookInput, resolveHomeDir, resolveHookProjectRoot } from "./hook-input.js";
import { sweepCodegraphZombiesBestEffort } from "./hook-sweep.js";
import type {
	CodegraphSessionStartOutcome,
	SessionStartHookOptions,
	SessionStartHookResult,
} from "./hook-types.js";
import {
	DEFAULT_SESSION_START_COOLDOWN_MS,
	readSessionStartCooldown,
	recordSessionStartFailure,
} from "./session-start-cooldown.js";
import { spawnDetachedSessionStartWorker, writeSessionStartNotice } from "./session-start-hook-runtime.js";
import { acquireSessionStartLock, releaseSessionStartLock, type SessionStartLock } from "./session-start-lock.js";
import { appendSessionStartOutcome } from "./session-start-outcome.js";
import {
	probeCodegraphAncestors,
	probeExactCodegraphProject,
	type CodegraphProjectState,
} from "./session-start-project.js";
import { SESSION_START_CWD_ENV, SESSION_START_LOCK_TOKEN_ENV } from "./session-start-worker.js";

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
export {
	executeCodegraphPostToolUseHook,
	runCodegraphPostToolUseHook,
	runCodegraphPostToolUseHookCli,
} from "./post-tool-use-hook.js";
export { resolveCodegraphCommandInvocation } from "./session-start-command.js";
export { runCodegraphSessionStartWorker } from "./session-start-worker.js";

export const CODEGRAPH_SESSION_START_NOTICE = "LazyCodex CodeGraph bootstrap scheduled in background";
export const DEFAULT_SESSION_START_LOCK_STALE_MS = 10 * 60 * 1_000;

type HookContext = {
	readonly baseCooldownMs: number;
	readonly env: Record<string, string | undefined>;
	readonly homeDir: string;
	readonly logOutcome: (outcome: CodegraphSessionStartOutcome) => void;
	readonly nowMs: number;
	readonly options: SessionStartHookOptions;
	readonly projectRoot: string;
};

export async function runCodegraphSessionStartHook(options: SessionStartHookOptions = {}): Promise<number> {
	return (await executeCodegraphSessionStartHook(options)).exitCode;
}

export async function executeCodegraphSessionStartHook(options: SessionStartHookOptions = {}): Promise<SessionStartHookResult> {
	const env = options.env ?? processEnv;
	const input = await readHookInput(options.stdin ?? processStdin);
	const projectRoot = resolveHookProjectRoot(input, options.cwd ?? processCwd());
	const homeDir = resolveHomeDir(env);
	const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
	if (config.codegraph?.enabled === false) return { action: "skipped-disabled", exitCode: 0 };

	const excludedRoots = config.codegraph?.excluded_roots;
	const exclusion = shouldExcludeCodegraphProject(projectRoot, {
		homeDir,
		...(excludedRoots === undefined ? {} : { excludedRoots }),
	});
	if (exclusion.excluded) return { action: "skipped-excluded", exitCode: 0 };

	pruneCodegraphProjectStoresBestEffort(homeDir, { debugLog: writeDebugLog });
	await sweepCodegraphZombiesBestEffort({
		env,
		homeDir,
		...(config.trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir: config.trustedCodegraphInstallDir }),
		log: writeDebugLog,
	}, options.sweepZombies);

	const nowMs = options.nowMs ?? Date.now();
	const context: HookContext = {
		baseCooldownMs: config.codegraph?.session_start_cooldown_ms ?? DEFAULT_SESSION_START_COOLDOWN_MS,
		env,
		homeDir,
		logOutcome: options.logOutcome ?? ((outcome) => appendSessionStartOutcome(homeDir, outcome, nowMs)),
		nowMs,
		options,
		projectRoot,
	};
	const projectDecision = handleProjectState(resolveHookProjectState(context), context);
	if (projectDecision !== null) return projectDecision;

	const cooldown = readSessionStartCooldown({
		baseCooldownMs: context.baseCooldownMs,
		homeDir,
		nowMs,
		projectRoot,
	});
	if (cooldown.kind === "inconclusive") return { action: "skipped-inconclusive", exitCode: 0 };
	if (cooldown.kind === "active") {
		safeLogOutcome(context.logOutcome, {
			action: "skipped-cooldown",
			cooldownUntil: cooldown.cooldownUntil,
			failureCount: cooldown.failureCount,
			projectRoot,
		});
		return { action: "skipped-cooldown", exitCode: 0 };
	}

	const lockResult = acquireSessionStartLock({
		homeDir,
		nowMs,
		projectRoot,
		staleMs: options.lockStaleMs ?? DEFAULT_SESSION_START_LOCK_STALE_MS,
	});
	if (lockResult.kind === "inconclusive") return { action: "skipped-inconclusive", exitCode: 0 };
	if (lockResult.kind === "locked") {
		safeLogOutcome(context.logOutcome, { action: "skipped-locked", projectRoot });
		return { action: "skipped-locked", exitCode: 0 };
	}
	if (lockResult.recoveredStale) return handleRecoveredStaleLock(lockResult.lock, context);

	const lockedProjectDecision = handleProjectState(resolveHookProjectState(context), context);
	if (lockedProjectDecision !== null) {
		releaseSessionStartLock(lockResult.lock);
		return lockedProjectDecision;
	}

	try {
		(options.spawnWorker ?? spawnDetachedSessionStartWorker)({
			args: [options.workerCliPath ?? defaultWorkerCliPath(), "hook", "session-start-worker"],
			command: process.execPath,
			env: buildCodegraphChildEnv({
				ambientEnv: env,
				codegraphEnv: {
					[SESSION_START_CWD_ENV]: projectRoot,
					[SESSION_START_LOCK_TOKEN_ENV]: lockResult.lock.token,
				},
				runtimeEnv: env,
			}),
		});
	} catch (error) {
		if (error instanceof Error) return handleSpawnFailure(error, lockResult.lock, context);
		throw error;
	}

	writeSessionStartNotice(options.stdout ?? processStdout, CODEGRAPH_SESSION_START_NOTICE);
	return { action: "spawned", exitCode: 0 };
}

function resolveHookProjectState(context: HookContext): CodegraphProjectState {
	const exact = probeExactCodegraphProject(context.projectRoot);
	if (exact.kind !== "uninitialized") return exact;
	return (context.options.ancestorProbe ?? probeCodegraphAncestors)(context.projectRoot);
}

function handleProjectState(state: CodegraphProjectState, context: HookContext): SessionStartHookResult | null {
	switch (state.kind) {
		case "inconclusive":
			return { action: "skipped-inconclusive", exitCode: 0 };
		case "initialized":
			return { action: "skipped-initialized", exitCode: 0 };
		case "nested-root":
			safeLogOutcome(context.logOutcome, { action: "skipped-nested-root", ancestorRoot: state.ancestorRoot, projectRoot: context.projectRoot });
			return { action: "skipped-nested-root", exitCode: 0 };
		case "uninitialized":
			return null;
	}
}

function handleRecoveredStaleLock(lock: SessionStartLock, context: HookContext): SessionStartHookResult {
	try {
		const cooldown = recordSessionStartFailure({
			action: "stale-lock",
			baseCooldownMs: context.baseCooldownMs,
			homeDir: context.homeDir,
			nowMs: context.nowMs,
			projectRoot: context.projectRoot,
		});
		releaseSessionStartLock(lock);
		safeLogOutcome(context.logOutcome, {
			action: "skipped-cooldown",
			cooldownUntil: cooldown.cooldownUntil,
			error: "recovered stale SessionStart worker lock",
			failureCount: cooldown.failureCount,
			projectRoot: context.projectRoot,
		});
		return { action: "skipped-cooldown", exitCode: 0 };
	} catch (error) {
		if (error instanceof Error) return { action: "skipped-inconclusive", exitCode: 0 };
		throw error;
	}
}

function handleSpawnFailure(error: unknown, lock: SessionStartLock, context: HookContext): SessionStartHookResult {
	try {
		const cooldown = recordSessionStartFailure({
			action: "spawn-failed",
			baseCooldownMs: context.baseCooldownMs,
			homeDir: context.homeDir,
			nowMs: context.nowMs,
			projectRoot: context.projectRoot,
		});
		releaseSessionStartLock(lock);
		safeLogOutcome(context.logOutcome, {
			action: "skipped-spawn-error",
			cooldownUntil: cooldown.cooldownUntil,
			error: error instanceof Error ? error.message : String(error),
			failureCount: cooldown.failureCount,
			projectRoot: context.projectRoot,
		});
	} catch (cooldownError) {
		if (cooldownError instanceof Error) return { action: "skipped-inconclusive", exitCode: 0 };
		throw cooldownError;
	}
	return { action: "skipped-spawn-error", exitCode: 0 };
}

function safeLogOutcome(logOutcome: (outcome: CodegraphSessionStartOutcome) => void, outcome: CodegraphSessionStartOutcome): void {
	try {
		logOutcome(outcome);
	} catch (error) {
		if (error instanceof Error) writeDebugLog(`failed to write SessionStart outcome: ${error.message}`);
		else throw error;
	}
}

function writeDebugLog(message: string): void {
	if (processEnv["OMO_CODEGRAPH_DEBUG"] !== "1") return;
	processStderr.write(`${message}\n`);
}

function defaultWorkerCliPath(): string {
	return fileURLToPath(import.meta.url);
}
