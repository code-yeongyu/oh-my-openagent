import type { PluginInput } from "@opencode-ai/plugin";
import type { TmuxConfig } from "../../config/schema";
interface SessionCreatedEvent {
    type: string;
    properties?: {
        info?: {
            id?: string;
            parentID?: string;
            title?: string;
        };
    };
}
export interface TmuxUtilDeps {
    isInsideTmux: () => boolean;
    getCurrentPaneId: () => string | undefined;
}
/**
 * State-first Tmux Session Manager
 *
 * Architecture:
 * 1. QUERY: Get actual tmux pane state (source of truth)
 * 2. DECIDE: Pure function determines actions based on state
 * 3. EXECUTE: Execute actions with verification
 * 4. UPDATE: Update internal cache only after tmux confirms success
 *
 * The internal `sessions` Map is just a cache for sessionId<->paneId mapping.
 * The REAL source of truth is always queried from tmux.
 */
export declare class TmuxSessionManager {
    private client;
    private tmuxConfig;
    private serverUrl;
    private sourcePaneId;
    private sessions;
    private pendingSessions;
    private spawnQueue;
    private deferredSessions;
    private deferredQueue;
    private deferredAttachInterval?;
    private deferredAttachTickScheduled;
    private nullStateCount;
    private deps;
    private pollingManager;
    constructor(ctx: PluginInput, tmuxConfig: TmuxConfig, deps?: TmuxUtilDeps);
    private isEnabled;
    private getCapacityConfig;
    private getSessionMappings;
    private removeTrackedSession;
    private markSessionClosePending;
    private queryWindowStateSafely;
    private tryCloseTrackedSession;
    private retryPendingCloses;
    private enqueueDeferredSession;
    private removeDeferredSession;
    private startDeferredAttachLoop;
    private stopDeferredAttachLoop;
    private tryAttachDeferredSession;
    private waitForSessionReady;
    onSessionCreated(event: SessionCreatedEvent): Promise<void>;
    private enqueueSpawn;
    onSessionDeleted(event: {
        sessionID: string;
    }): Promise<void>;
    private closeSessionById;
    createEventHandler(): (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    cleanup(): Promise<void>;
}
export {};
