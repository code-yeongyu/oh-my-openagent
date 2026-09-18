export declare function buildExplicitPlanContext(params: {
    readonly explicitPlanName: string;
    readonly sessionId: string;
    readonly timestamp: string;
    readonly activeAgent: string;
    readonly worktreePath: string | undefined;
    readonly worktreeBlock: string;
    readonly directory: string;
}): string;
