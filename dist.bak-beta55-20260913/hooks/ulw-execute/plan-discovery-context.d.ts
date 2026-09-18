import type { BoulderState, BoulderWorkResumeOption } from "../../features/boulder-state";
export declare function shouldResumeExistingState(input: {
    readonly existingState: BoulderState | null;
    readonly preferredPlanPath: string | null;
}): boolean;
export declare function shouldDiscoverPlans(input: {
    readonly existingState: BoulderState | null;
    readonly explicitPlanName: string | null;
    readonly preferredPlanPath: string | null;
}): boolean;
export declare function shouldResumeSingleWorkOption(input: {
    readonly directory: string;
    readonly option: BoulderWorkResumeOption;
    readonly preferredPlanPath: string | null;
}): boolean;
export declare function buildPlanDiscoveryContext(params: {
    readonly contextInfo: string;
    readonly sessionId: string;
    readonly timestamp: string;
    readonly activeAgent: string;
    readonly worktreePath: string | undefined;
    readonly worktreeBlock: string;
    readonly directory: string;
    readonly preferredPlanPath: string | null;
}): string;
