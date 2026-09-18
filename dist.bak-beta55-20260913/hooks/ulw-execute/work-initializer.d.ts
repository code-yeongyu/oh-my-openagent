export declare function createNewWorkOrInitialize(params: {
    readonly directory: string;
    readonly planPath: string;
    readonly sessionId: string;
    readonly activeAgent: string;
    readonly worktreePath: string | undefined;
}): void;
export declare function buildAutoSelectedPlanContextWithStateInit(params: {
    readonly planPath: string;
    readonly sessionId: string;
    readonly timestamp: string;
    readonly activeAgent: string;
    readonly worktreePath: string | undefined;
    readonly worktreeBlock: string;
    readonly directory: string;
    readonly reason?: string;
}): string;
