import type { SessionAgentResolver, SessionStatusMap, TuiBackgroundSnapshotProvider, TuiMirrorClient } from "./snapshot-builder";
import type { TuiRuntimeSnapshot } from "./snapshot-schema";
export type TuiStateMirrorInput = {
    readonly client: TuiMirrorClient;
    readonly projectDir: string;
    readonly backgroundManager: TuiBackgroundSnapshotProvider;
    readonly getStatuses?: () => Promise<SessionStatusMap>;
    readonly sessionAgentResolver?: SessionAgentResolver;
    readonly reportFlushError?: (error: Error) => void;
};
export declare class TuiStateMirror {
    private readonly snapshotInput;
    private readonly reportFlushError;
    private heartbeatID;
    private debounceID;
    private pendingFlush;
    private resolvePendingFlush;
    private inFlightFlush;
    private stopped;
    constructor(input: TuiStateMirrorInput);
    buildSnapshot(): Promise<TuiRuntimeSnapshot>;
    flush(): Promise<void>;
    onEvent(_event: unknown): void;
    start(): void;
    stop(): void;
    private runFlush;
    private writeSnapshotNoThrow;
}
