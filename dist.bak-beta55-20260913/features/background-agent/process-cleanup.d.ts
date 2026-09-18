type ProcessCleanupSignal = NodeJS.Signals | "beforeExit" | "exit";
/** @internal test-only */
export declare function __disableScheduledForcedExitForTesting(): void;
/** @internal test-only */
export declare function __enableScheduledForcedExitForTesting(): void;
/** @internal test-only seam */
export declare function __isShutdownInProgressForTesting(): boolean;
/** @internal test-only seam */
export declare function __setShutdownInProgressForTesting(value: boolean): void;
/** @internal test-only seam: exposes the error normalizer used by registerErrorEvent. */
export declare function describeProcessCleanupError(error: unknown): Record<string, unknown>;
/** @internal test-only seam: exposes the harmless-error filter used by registerErrorEvent. */
export declare function isHarmlessShutdownError(error: unknown): boolean;
interface CleanupTarget {
    shutdown(): void | Promise<void>;
}
export declare function __getProcessCleanupSignalListenerForTesting(signal: ProcessCleanupSignal): (() => void) | undefined;
export declare function registerManagerForCleanup(manager: CleanupTarget): void;
export declare function unregisterManagerForCleanup(manager: CleanupTarget): void;
/** @internal - test-only reset for module-level singleton state */
export declare function _resetForTesting(): void;
export {};
