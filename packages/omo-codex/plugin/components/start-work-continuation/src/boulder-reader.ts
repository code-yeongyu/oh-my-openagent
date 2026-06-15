import { join } from "node:path";
import type { BoulderWorkStatus, PlanChecklist } from "@oh-my-opencode/boulder-state";
import {
	getBoulderFilePath,
	getPlanChecklist,
	getWorkForSession,
	normalizeSessionId,
	resolveBoulderPlanPathForWork,
} from "@oh-my-opencode/boulder-state";

export type { PlanChecklist };

export type ContinuationState = {
	readonly planName: string;
	readonly planPath: string;
	readonly boulderPath: string;
	readonly ledgerPath: string;
	readonly worktreePath: string | null;
	readonly checklist: PlanChecklist;
};

export function readContinuationState(cwd: string, sessionId: string): ContinuationState | null {
	const work = getWorkForSession(cwd, normalizeSessionId(sessionId, "codex"));
	if (work === null || !isContinuableStatus(work.status)) return null;
	const planPath = resolveBoulderPlanPathForWork(cwd, work);
	const checklist = getPlanChecklist(planPath);
	if (checklist.remaining === 0) return null;
	return {
		planName: work.plan_name,
		planPath,
		boulderPath: getBoulderFilePath(cwd),
		ledgerPath: join(cwd, ".omo", "start-work", "ledger.jsonl"),
		worktreePath: work.worktree_path ?? null,
		checklist,
	};
}

function isContinuableStatus(status: BoulderWorkStatus | undefined): boolean {
	return status === "active" || status === "paused";
}
