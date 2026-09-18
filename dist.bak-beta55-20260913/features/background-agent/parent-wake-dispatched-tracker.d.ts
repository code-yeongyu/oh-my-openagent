import { type PendingParentWake } from "./parent-wake-dedupe";
type ParentWakeDispatchedTrackerOptions = {
    readonly failureRequeueWindowMs: number;
    readonly onFailureRequeueWindowElapsed: (sessionID: string, wake: PendingParentWake) => void;
};
export declare class ParentWakeDispatchedTracker {
    private readonly options;
    private dispatchedParentWakes;
    private dispatchedParentWakeTimers;
    private inFlightDispatches;
    private notificationPreparations;
    constructor(options: ParentWakeDispatchedTrackerOptions);
    getWakes(): Map<string, PendingParentWake>;
    getTimers(): Map<string, ReturnType<typeof setTimeout>>;
    markInFlight(sessionID: string): void;
    clearInFlight(sessionID: string): void;
    hasInFlight(sessionID: string): boolean;
    reserveNotificationPreparation(sessionID: string): void;
    releaseNotificationPreparation(sessionID: string): void;
    hasNotificationPreparation(sessionID: string): boolean;
    getWake(sessionID: string): PendingParentWake | undefined;
    clearWake(sessionID: string): void;
    trackWake(sessionID: string, wake: PendingParentWake, dispatchedAt: number): void;
    refreshWakeTimer(sessionID: string): void;
    private scheduleFailureWindowTimer;
    shutdown(): void;
}
export {};
