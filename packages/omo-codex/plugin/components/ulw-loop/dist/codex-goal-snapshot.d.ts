export type CodexGoalSnapshotStatus = "active" | "complete" | "cancelled" | "failed" | "unknown";
export interface CodexGoalSnapshot {
    available: boolean;
    objective?: string;
    status?: CodexGoalSnapshotStatus;
    raw: unknown;
}
export interface CodexGoalReconciliation {
    ok: boolean;
    snapshot: CodexGoalSnapshot;
    warnings: string[];
    errors: string[];
}
export interface ReconcileCodexGoalOptions {
    expectedObjective: string;
    acceptedObjectives?: readonly string[];
    allowedStatuses?: readonly CodexGoalSnapshotStatus[];
    requireSnapshot?: boolean;
    requireComplete?: boolean;
}
export declare class CodexGoalSnapshotError extends Error {
}
export declare function parseCodexGoalSnapshot(value: unknown): CodexGoalSnapshot;
export declare function readCodexGoalSnapshotInput(raw: string | undefined, cwd?: string): Promise<CodexGoalSnapshot | null>;
export declare function reconcileCodexGoalSnapshot(snapshot: CodexGoalSnapshot | null | undefined, options: ReconcileCodexGoalOptions): CodexGoalReconciliation;
export declare function formatCodexGoalReconciliation(reconciliation: CodexGoalReconciliation): string;
export interface CodexGoalMismatchRecovery {
    readonly message: string;
    readonly details: {
        readonly expectedObjective: string;
        readonly receivedObjective: string;
    };
}
/**
 * The reconciliation errors normalize whitespace for comparison, which makes the
 * quoted objective unusable as a copy source. Recovery therefore carries the
 * plan's `codexObjective` verbatim so the agent can paste it into `update_goal`.
 */
export declare function codexGoalMismatchRecovery(expectedObjective: string, snapshot: CodexGoalSnapshot | null | undefined): CodexGoalMismatchRecovery;
