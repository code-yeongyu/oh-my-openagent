import type { BoulderState, BoulderWorkResumeOption } from "../../features/boulder-state";
export declare function buildAutoSelectedPlanContextInfoOnly(params: {
    readonly planPath: string;
    readonly sessionId: string;
    readonly timestamp: string;
    readonly worktreeBlock: string;
    readonly reason?: string;
}): string;
export declare function buildMultipleActiveWorksContext(params: {
    readonly resumeOptions: readonly BoulderWorkResumeOption[];
    readonly sessionId: string;
    readonly timestamp: string;
}): string;
export declare function buildExistingSessionContext(params: {
    readonly existingState: BoulderState;
    readonly sessionId: string;
    readonly activeAgent: string;
    readonly worktreePath: string | undefined;
    readonly worktreeBlock: string;
    readonly directory: string;
}): string;
