import { type ParentWakePromptContext, type PendingParentWake } from "./parent-wake-dedupe";
type ParentWakePendingQueueOptions = {
    readonly pendingRetryMs: number;
    readonly enqueueNotificationForParent: (parentSessionID: string | undefined, operation: () => Promise<void>) => Promise<void>;
};
export declare class ParentWakePendingQueue {
    private readonly options;
    private pendingParentWakes;
    private pendingParentWakeTimers;
    constructor(options: ParentWakePendingQueueOptions);
    getWakes(): Map<string, PendingParentWake>;
    getTimers(): Map<string, ReturnType<typeof setTimeout>>;
    hasWake(sessionID: string): boolean;
    getWake(sessionID: string): PendingParentWake | undefined;
    deleteWake(sessionID: string): void;
    queueWake(sessionID: string, notification: string, promptContext: ParentWakePromptContext, shouldReply: boolean): void;
    requeueWake(sessionID: string, latestWake: PendingParentWake): void;
    scheduleFlush(sessionID: string, operation: () => Promise<void>, delayMs?: number): void;
    clearTimer(sessionID: string): void;
    shutdown(): void;
}
export {};
