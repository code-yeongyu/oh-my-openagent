import type { PendingParentWake } from "./parent-wake-dedupe";
import type { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker";
import type { ParentWakeSessionInspector } from "./parent-wake-session-inspector";
type ParentWakeWindowRecoveryInput = {
    readonly sessionID: string;
    readonly wake: PendingParentWake;
    readonly dispatchedTracker: ParentWakeDispatchedTracker;
    readonly sessionInspector: ParentWakeSessionInspector;
    readonly requeueWake: (wake: PendingParentWake) => void;
    readonly scheduleFlush: () => void;
};
export declare function handleDispatchedParentWakeWindowElapsed(input: ParentWakeWindowRecoveryInput): Promise<void>;
export declare function logParentWakeWindowRecoveryError(sessionID: string, error: unknown): void;
export declare function rescheduleParentWakeWindowRecoveryAfterError(sessionID: string, wake: PendingParentWake, dispatchedTracker: ParentWakeDispatchedTracker): void;
export {};
