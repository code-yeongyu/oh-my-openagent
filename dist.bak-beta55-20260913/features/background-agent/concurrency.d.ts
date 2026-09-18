import type { BackgroundTaskConfig } from "../../config/schema";
export declare class ConcurrencyManager {
    private config?;
    private counts;
    private queues;
    constructor(config?: BackgroundTaskConfig);
    getConcurrencyLimit(model: string): number;
    getConcurrencyKey(model: string): string;
    acquire(model: string, taskId?: string): Promise<void>;
    release(model: string): void;
    /**
     * Cancel a specific task's waiter in the queue for a model.
     * Returns true if a matching waiter was found and cancelled.
     */
    cancelWaiter(model: string, taskId: string): boolean;
    /**
     * Cancel all waiting acquires for a model. Used during cleanup.
     */
    cancelWaiters(model: string): void;
    /**
     * Clear all state. Used during manager cleanup/shutdown.
     * Cancels all pending waiters.
     */
    clear(): void;
    /**
     * Get current count for a model (for testing/debugging)
     */
    getCount(model: string): number;
    /**
     * Get queue length for a model (for testing/debugging)
     */
    getQueueLength(model: string): number;
}
