export type WorkspaceApplyEditConcurrentPhase = "applying" | "settled";

const CONCURRENT_FAILURE_REASON_BY_PHASE: Readonly<Record<WorkspaceApplyEditConcurrentPhase, string>> = {
	applying: "workspace/applyEdit is already in progress for this workspace mutation",
	settled: "workspace/applyEdit was already handled for this workspace mutation",
};

export const CANONICAL_CONCURRENT_WORKSPACE_APPLY_EDIT_FAILURE_REASON =
	"workspace/applyEdit concurrent for this workspace mutation";

export function workspaceApplyEditConcurrentFailureReason(phase: WorkspaceApplyEditConcurrentPhase): string {
	return CONCURRENT_FAILURE_REASON_BY_PHASE[phase];
}

export function canonicalizeWorkspaceApplyEditFailureReason(reason: string): string {
	return Object.values(CONCURRENT_FAILURE_REASON_BY_PHASE).includes(reason)
		? CANONICAL_CONCURRENT_WORKSPACE_APPLY_EDIT_FAILURE_REASON
		: reason;
}
