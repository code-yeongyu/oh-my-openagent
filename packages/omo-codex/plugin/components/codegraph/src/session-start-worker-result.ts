import { env as processEnv, stderr as processStderr } from "node:process";

import type { CodegraphCommandResolution } from "../../../../../utils/src/codegraph/resolve.ts";
import type { CodegraphSessionStartOutcome, WorkerAction } from "./hook-types.js";
import {
	clearSessionStartCooldown,
	recordSessionStartFailure,
	type SessionStartFailureAction,
} from "./session-start-cooldown.js";
import type { CodegraphProjectState } from "./session-start-project.js";

export type WorkerResultContext = {
	readonly baseCooldownMs: number;
	readonly homeDir: string;
	readonly logOutcome: (outcome: CodegraphSessionStartOutcome) => void;
	readonly nowMs: () => number;
	readonly projectRoot: string;
};

export type WorkerRunResult = {
	readonly action: WorkerAction;
	readonly releaseLock: boolean;
};

export function finishWorkerProjectState(
	state: CodegraphProjectState,
	context: WorkerResultContext,
): WorkerRunResult | null {
	switch (state.kind) {
		case "inconclusive":
			return finishWorkerFailure("skipped-probe-error", "skipped-probe-error", {
				error: state.reason,
				projectRoot: context.projectRoot,
			}, context);
		case "initialized":
			return finishWorkerSuccess("skipped-initialized", { projectRoot: context.projectRoot }, context);
		case "nested-root":
			return finishWorkerSuccess("skipped-nested-root", {
				ancestorRoot: state.ancestorRoot,
				projectRoot: context.projectRoot,
			}, context);
		case "uninitialized":
			return null;
	}
}

export function finishWorkerInitialization(
	state: CodegraphProjectState,
	detail: {
		readonly exitCode: number;
		readonly source: CodegraphCommandResolution["source"];
	},
	context: WorkerResultContext,
): WorkerRunResult {
	switch (state.kind) {
		case "inconclusive":
			return finishWorkerFailure("skipped-probe-error", "skipped-probe-error", {
				error: state.reason,
				...detail,
				projectRoot: context.projectRoot,
				timedOut: false,
			}, context);
		case "initialized":
			return finishWorkerSuccess("initialized", {
				...detail,
				projectRoot: context.projectRoot,
				timedOut: false,
			}, context);
		case "nested-root":
			return finishWorkerFailure("failed", "failed", {
				...detail,
				error: `codegraph init resolved to ancestor database at ${state.ancestorRoot}`,
				projectRoot: context.projectRoot,
				timedOut: false,
			}, context);
		case "uninitialized":
			return finishWorkerFailure("failed", "failed", {
				...detail,
				error: "codegraph init completed without creating an exact project database",
				projectRoot: context.projectRoot,
				timedOut: false,
			}, context);
	}
}

export function finishWorkerFailure(
	action: WorkerAction,
	failureAction: SessionStartFailureAction,
	detail: Omit<CodegraphSessionStartOutcome, "action">,
	context: WorkerResultContext,
): WorkerRunResult {
	let releaseLock = true;
	try {
		recordSessionStartFailure({
			action: failureAction,
			baseCooldownMs: context.baseCooldownMs,
			homeDir: context.homeDir,
			nowMs: context.nowMs(),
			projectRoot: context.projectRoot,
		});
	} catch (error) {
		if (error instanceof Error) releaseLock = false;
		else throw error;
	}
	safeLogWorkerOutcome(context.logOutcome, { ...detail, action });
	return { action, releaseLock };
}

export function finishWorkerSuccess(
	action: WorkerAction,
	detail: Omit<CodegraphSessionStartOutcome, "action">,
	context: WorkerResultContext,
): WorkerRunResult {
	try {
		clearSessionStartCooldown({ homeDir: context.homeDir, projectRoot: context.projectRoot });
	} catch (error) {
		if (error instanceof Error) writeDebugLog(`failed to clear SessionStart cooldown: ${error.message}`);
		else throw error;
	}
	safeLogWorkerOutcome(context.logOutcome, { ...detail, action });
	return { action, releaseLock: true };
}

export function finishWorkerNeutral(
	action: WorkerAction,
	detail: Omit<CodegraphSessionStartOutcome, "action">,
	context: WorkerResultContext,
): WorkerRunResult {
	safeLogWorkerOutcome(context.logOutcome, { ...detail, action });
	return { action, releaseLock: true };
}

export function safeLogWorkerOutcome(
	logOutcome: (outcome: CodegraphSessionStartOutcome) => void,
	outcome: CodegraphSessionStartOutcome,
): void {
	try {
		logOutcome(outcome);
	} catch (error) {
		if (error instanceof Error) processStderr.write(`[codegraph-session-start] failed to write outcome: ${error.message}\n`);
		else throw error;
	}
}

function writeDebugLog(message: string): void {
	if (processEnv["OMO_CODEGRAPH_DEBUG"] !== "1") return;
	processStderr.write(`[codegraph-session-start] ${message}\n`);
}
