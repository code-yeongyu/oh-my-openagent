import type { PendingTaskRef, SessionState } from "./types";
export declare const ATLAS_SESSION_STATE_TTL_MS: number;
export declare const ATLAS_SESSION_PRUNE_INTERVAL_MS: number;
type PendingAtlasCall = {
    readonly kind: "file";
    readonly sessionID?: string;
    readonly filePath: string;
    readonly planSnapshot?: string;
} | {
    readonly kind: "task";
    readonly sessionID?: string;
    readonly task: PendingTaskRef;
};
export declare class AtlasLifecycleStore {
    readonly sessions: Map<string, SessionState>;
    readonly pendingFilePaths: Map<string, string>;
    readonly pendingTaskRefs: Map<string, PendingTaskRef>;
    readonly pendingPlanSnapshots: Map<string, string>;
    readonly pendingCalls: Map<string, PendingAtlasCall>;
    readonly sessionCallIDs: Map<string, Set<string>>;
    private readonly lastAccessedAt;
    private pruneInterval;
    private disposed;
    private readonly disposedState;
    getExistingState(sessionID: string): SessionState | undefined;
    getOrCreateState(sessionID: string): SessionState;
    trackFileCall(callID: string, sessionID: string | undefined, filePath: string): void;
    trackTaskCall(callID: string, sessionID: string | undefined, task: PendingTaskRef): void;
    trackPlanSnapshot(callID: string, snapshot: string): void;
    consumeFileCall(callID: string | undefined): Extract<PendingAtlasCall, {
        kind: "file";
    }> | undefined;
    consumeTaskCall(callID: string | undefined): Extract<PendingAtlasCall, {
        kind: "task";
    }> | undefined;
    clearPendingCall(callID: string | undefined): void;
    cleanupSession(sessionID: string): void;
    dispose(): void;
    get sizes(): {
        readonly sessions: number;
        readonly pendingCalls: number;
        readonly sessionIndexes: number;
        readonly hasPruneInterval: boolean;
    };
    private replaceCall;
    private removeSessionCallID;
    private ensurePruneInterval;
    private prune;
}
export {};
