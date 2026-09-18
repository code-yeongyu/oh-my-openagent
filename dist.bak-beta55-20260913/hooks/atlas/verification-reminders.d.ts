export declare function buildCompletionGate(planName: string, sessionId: string): string;
export declare function buildOrchestratorReminder(planName: string, progress: {
    total: number;
    completed: number;
}, sessionId: string, autoCommit?: boolean, includeCompletionGate?: boolean): string;
export declare function buildFinalWaveApprovalReminder(planName: string, progress: {
    total: number;
    completed: number;
}, sessionId: string): string;
export declare function buildStandaloneVerificationReminder(sessionId: string): string;
export declare function buildMissingVerdictEscalation(planName: string, taskLabel: string, sessionId: string): string;
export declare function buildRejectedVerdictEscalation(planName: string, taskLabel: string, sessionId: string): string;
export declare function buildAdvanceDirective(planName: string): string;
