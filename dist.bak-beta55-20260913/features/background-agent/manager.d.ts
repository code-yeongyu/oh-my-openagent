import type { PluginInput } from "@opencode-ai/plugin";
import type { BackgroundTaskConfig, TmuxConfig } from "../../config/schema";
import type { ModelFallbackControllerAccessor } from "../../hooks/model-fallback";
import { log } from "../../shared";
import { type SubagentSpawnContext } from "./subagent-spawn-limits";
import { TaskHistory } from "./task-history";
import type { BackgroundTask, BackgroundTaskSnapshot, LaunchInput, ResumeInput } from "./types";
interface EventProperties {
    sessionID?: string;
    info?: {
        id?: string;
        sessionID?: string;
        role?: unknown;
        error?: unknown;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
interface Event {
    type: string;
    properties?: EventProperties;
}
export interface SubagentSessionCreatedEvent {
    sessionID: string;
    parentID: string;
    title: string;
}
export type OnSubagentSessionCreated = (event: SubagentSessionCreatedEvent) => Promise<void>;
export interface SubagentSessionDeletedEvent {
    sessionID: string;
}
export type OnSubagentSessionDeleted = (event: SubagentSessionDeletedEvent) => Promise<void>;
export interface BackgroundManagerConfig {
    pluginContext: PluginInput;
    config?: BackgroundTaskConfig;
    tmuxConfig?: TmuxConfig;
    onSubagentSessionCreated?: OnSubagentSessionCreated;
    onSubagentSessionDeleted?: OnSubagentSessionDeleted;
    onShutdown?: () => void | Promise<void>;
    enableParentSessionNotifications?: boolean;
    modelFallbackControllerAccessor?: ModelFallbackControllerAccessor;
    log?: typeof log;
}
export declare class BackgroundManager {
    private tasks;
    private tasksByParentSession;
    private notifications;
    private pendingNotifications;
    private pendingByParent;
    private client;
    private directory;
    private pollingInterval?;
    private pollingInFlight;
    private concurrencyManager;
    private shutdownTriggered;
    private config?;
    private tmuxEnabled;
    private onSubagentSessionCreated?;
    private onSubagentSessionDeleted?;
    private onShutdown?;
    private queuesByKey;
    private processingKeys;
    private completionTimers;
    private readonly syncAttachedSessions;
    private completedTaskArchive;
    private completedTaskSummaries;
    private idleDeferralTimers;
    private cancellationEvents;
    private notificationQueueByParent;
    private readonly parentWakeNotifier;
    private parentWakeTextDeltaBuffers;
    private observedOutputSessions;
    private observedIncompleteTodosBySession;
    private rootDescendantCounts;
    private preStartDescendantReservations;
    private enableParentSessionNotifications;
    private modelFallbackControllerAccessor?;
    private logger;
    private loggedSessionStatusUnavailable;
    readonly taskHistory: TaskHistory;
    private cachedCircuitBreakerSettings?;
    private readonly scheduledFlushSettledCounts;
    private readonly scheduledFlushSettledWaiters;
    constructor(config: BackgroundManagerConfig);
    private abortSessionWithLogging;
    assertCanSpawn(parentSessionID: string): Promise<SubagentSpawnContext>;
    reserveSubagentSpawn(parentSessionID: string): Promise<{
        spawnContext: SubagentSpawnContext;
        descendantCount: number;
        commit: () => number;
        rollback: () => void;
    }>;
    acquireSyncSubagentConcurrency(model: string, taskId?: string): Promise<void>;
    releaseSyncSubagentConcurrency(model: string): void;
    private registerRootDescendant;
    private unregisterRootDescendant;
    private markPreStartDescendantReservation;
    private settlePreStartDescendantReservation;
    private rollbackPreStartDescendantReservation;
    private addTask;
    private removeTask;
    private archiveCompletedTask;
    private updateTaskParent;
    private captureResumeTaskSnapshot;
    private restoreTaskAfterSkippedResume;
    private removeTaskFromParentIndex;
    launch(input: LaunchInput): Promise<BackgroundTask>;
    private processKey;
    private startTask;
    getTask(id: string): BackgroundTask | undefined;
    getTasksSnapshot(): BackgroundTaskSnapshot[];
    getTasksByParentSession(sessionID: string): BackgroundTask[];
    /**
     * Return whether a session has direct child background tasks still in flight.
     *
     * Intentionally checks immediate children only, not all descendants. A
     * grandchild's completion wake is addressed to its immediate parent session,
     * never to this ancestor, so blocking on descendants would make the sync poll
     * loop wait for grandchildren it can never be woken for (returning a stale
     * pre-grandchild turn after the settle window, or hitting the sync timeout for
     * long-running descendants). When a deliverable genuinely depends on a
     * grandchild, the direct child stays running until that grandchild resolves, so
     * the immediate-child check already covers it; when the child fire-and-forgets
     * a grandchild, this session correctly does not wait for work it cannot consume.
     */
    hasActiveChildTasks(sessionID: string): boolean;
    /**
     * Return whether a parent-wake notification for this session is queued, scheduled,
     * mid-dispatch, or dispatched-but-not-yet-consumed. Lets a sync poll loop keep
     * waiting across the gap between "all children finished" and "the
     * notification-triggered turn started", instead of declaring the task complete
     * during that window. The in-flight check is essential: while a wake is being
     * dispatched the pending entry is already deleted and the dispatched entry is not
     * yet tracked, so the other three maps would all report false for several seconds.
     * The notification-preparation check covers the earlier window: a child is marked
     * terminal (so it no longer counts as active) before the completion path finishes
     * awaiting its session teardown and queues the wake, so without it the predicate
     * would report false between the status flip and the wake landing in the pending map.
     */
    hasPendingParentWake(sessionID: string): boolean;
    private hasUndeliveredParentWake;
    private updateBackgroundTaskMarker;
    getAllDescendantTasks(sessionID: string): BackgroundTask[];
    findBySession(sessionID: string): BackgroundTask | undefined;
    /**
     * Marks a session as being polled by a run_in_background=false continuation so the
     * completion cleanup timer neither drops the task nor deletes the session underneath it.
     * The returned detach restarts the cleanup grace window once the waiter leaves.
     */
    attachSyncContinuation(sessionID: string): () => void;
    private resolveTaskAttemptBySession;
    private getConcurrencyKeyFromInput;
    private getRawConcurrencyKeyFromInput;
    private getRawConcurrencyKeyFromTask;
    /**
     * Track a task created elsewhere (e.g., from task) for notification tracking.
     * This allows tasks created by other tools to receive the same toast/prompt notifications.
     */
    trackTask(input: {
        taskId: string;
        sessionId: string;
        parentSessionId: string;
        description: string;
        agent?: string;
        parentAgent?: string;
        concurrencyKey?: string;
    }): Promise<BackgroundTask>;
    resume(input: ResumeInput): Promise<BackgroundTask>;
    private checkSessionTodos;
    private markSessionOutputObserved;
    private clearDispatchedParentWake;
    private requeueDispatchedParentWake;
    private clearSessionOutputObserved;
    private clearSessionTodoObservation;
    private deferCancellationEvent;
    private replayCancellationEvents;
    private discardCancellationEvents;
    private shouldHoldDispatchedParentWakeForTextDelta;
    private parentWakeTextDeltaBufferKey;
    private clearParentWakeTextDeltaBuffers;
    handleEvent(event: Event): void;
    private interruptTaskFromAsyncPromptFailure;
    private handleSessionErrorEvent;
    private tryFallbackRetry;
    markForNotification(task: BackgroundTask): void;
    getPendingNotifications(sessionID: string): BackgroundTask[];
    clearNotifications(sessionID: string): void;
    queuePendingNotification(sessionID: string | undefined, notification: string): void;
    injectPendingNotificationsIntoChatMessage(_output: {
        parts: Array<{
            type: string;
            text?: string;
            [key: string]: unknown;
        }>;
    }, sessionID: string): void;
    /**
     * Validates that a session has actual assistant/tool output before marking complete.
     * Prevents premature completion when session.idle fires before agent responds.
     */
    private validateSessionHasOutput;
    private clearNotificationsForTask;
    /**
     * Remove task from pending tracking for its parent session.
     * Cleans up the parent entry if no pending tasks remain.
     */
    private cleanupPendingByParent;
    private clearTaskHistoryWhenParentTasksGone;
    private scheduleTaskRemoval;
    cancelTask(taskId: string, options?: {
        source?: string;
        reason?: string;
        abortSession?: boolean;
        skipNotification?: boolean;
    }): Promise<boolean>;
    /**
     * Cancels a pending task by removing it from queue and marking as cancelled.
     * Does NOT abort session (no session exists yet) or release concurrency slot (wasn't acquired).
     */
    cancelPendingTask(taskId: string): boolean;
    private startPolling;
    private stopPolling;
    private registerProcessCleanup;
    private unregisterProcessCleanup;
    /**
     * Get all running tasks (for compaction hook)
     */
    getRunningTasks(): BackgroundTask[];
    /**
     * Get all non-running tasks still in memory (for compaction hook)
     */
    getNonRunningTasks(): BackgroundTask[];
    /**
     * Safely complete a task with race condition protection.
     * Returns true if task was successfully completed, false if already completed by another path.
     */
    private tryCompleteTask;
    private notifyParentSession;
    private resolveParentWakePromptContext;
    private isSessionActive;
    private recordScheduledFlushSettled;
    /**
     * Test-only: monotonic count of scheduled parent-wake flushes that have settled
     * for this session (the real onScheduledFlushSettled signal). Capture this
     * BEFORE triggering a flush, then awaitScheduledFlush(sessionID, captured) so a
     * settle that races between trigger and await is not missed.
     */
    getScheduledFlushSettledCount(sessionID: string): number;
    /**
     * Test-only: resolves once the settled-flush count for this session exceeds
     * `sinceCount` (captured before the flush was triggered). Deterministic — no
     * blind sleep past the debounce, and no registration-after-settle race.
     */
    awaitScheduledFlush(sessionID: string, sinceCount: number): Promise<void>;
    private queuePendingParentWake;
    private flushPendingParentWake;
    private hasRunningTasks;
    private pruneStaleTasksAndNotifications;
    private checkAndInterruptStaleTasks;
    private verifySessionExists;
    private failCrashedTask;
    private pollRunningTasks;
    /**
     * Shutdown the manager gracefully.
     * Cancels all pending concurrency waiters and clears timers.
     * Should be called when the plugin is unloaded.
     */
    shutdown(): Promise<void>;
    private enqueueNotificationForParent;
}
export {};
