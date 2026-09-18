import type { PluginInput } from "@opencode-ai/plugin";
import type { TmuxConfig } from "../../config/schema";
import type { WindowState } from "./types";
import * as sharedModule from "../../shared";
import { executeActions, executeAction } from "./action-executor";
type OpencodeClient = PluginInput["client"];
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
    queryWindowState: (paneId: string) => Promise<WindowState | null>;
    waitForSessionReady: (params: {
        client: OpencodeClient;
        sessionId: string;
    }) => Promise<boolean>;
    executeActions: typeof executeActions;
    executeAction: typeof executeAction;
    log: typeof sharedModule.log;
}
/**
 * Options passed to TmuxSessionManager at construction time.
 *
 * Distinct from `TmuxUtilDeps` (low-level tmux util injection): these are
 * external policy hooks the manager defers to without owning the policy.
 */
export interface TmuxSessionManagerOptions {
    /**
     * Predicate the manager calls in `onSessionCreated` to decide whether this
     * session should be ignored entirely. Used to keep team-mode member sessions
     * out of the subagent pane tracking, since team-layout-tmux owns their pane
     * lifecycle separately and double-tracking causes pane double-close races
     * and stale entries in the subagent panel.
     *
     * Defaults to `() => false` (track everything).
     */
    shouldSkipSession?: (sessionId: string) => boolean;
}
export declare class TmuxSessionManager {
    private client;
    private tmuxConfig;
    private projectDirectory;
    private serverUrl;
    private ctxServerUrl;
    private sourcePaneId;
    private sessions;
    private pendingSessions;
    private closedByPolling;
    private readonly failedReadinessCache;
    private spawnQueue;
    private deferredSessions;
    private deferredQueue;
    private deferredAttachInterval?;
    private deferredAttachTickScheduled;
    private nullStateCount;
    private deps;
    private shouldSkipSession;
    private pollingManager;
    private isolatedContainerPaneId;
    private isolatedWindowPaneId;
    private isolatedContainerNullStateCount;
    private staleSweepCompleted;
    private staleSweepInProgress;
    private isolatedSessionManagerId;
    constructor(ctx: PluginInput, tmuxConfig: TmuxConfig, deps?: Partial<TmuxUtilDeps>, options?: TmuxSessionManagerOptions);
    private isEnabled;
    private isIsolated;
    private getEffectiveSourcePaneId;
    private spawnInIsolatedContainer;
    private getCapacityConfig;
    private getSessionMappings;
    getTrackedPaneId(sessionId: string): string | undefined;
    getServerUrl(): string;
    getCtxServerUrl(): string | undefined;
    private removeTrackedSession;
    private reassignIsolatedContainerAnchor;
    private cleanupIsolatedContainerAfterSessionDeletion;
    private markSessionClosePending;
    private queryWindowStateSafely;
    private activateTrackedSessionPane;
    private windowStateContainsPane;
    private finalizeForceRemoveCandidate;
    private canAutoActivatePane;
    private closeTrackedSessionPane;
    private finalizeTrackedSessionClose;
    private closeTrackedSession;
    private retryPendingCloses;
    private enqueueDeferredSession;
    private removeDeferredSession;
    private startDeferredAttachLoop;
    private stopDeferredAttachLoop;
    private beginPendingSession;
    private ensureSessionReadyBeforeSpawn;
    private getSessionStatusType;
    private spawnPendingSession;
    private getEventSessionId;
    private retryFailedReadinessSession;
    private tryAttachDeferredSession;
    onSessionCreated(event: SessionCreatedEvent): Promise<void>;
    private enqueueSpawn;
    onSessionDeleted(event: {
        sessionID: string;
    }): Promise<void>;
    private closeSessionById;
    private closeSessionFromPolling;
    private shouldSkipRespawnAfterPollingClose;
    onEvent(event: {
        type: string;
        properties?: Record<string, unknown>;
    }): void;
    createEventHandler(): (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    cleanup(): Promise<void>;
    private sweepStaleIsolatedSessionsOnce;
}
export {};
