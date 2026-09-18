import type { OutputBatch, OutputLine } from "./types";
export type TimerHandle = ReturnType<typeof setTimeout> | number | {
    unref?(): void;
};
export interface SchedulerDeps {
    setTimer(fn: () => void, delayMs: number): TimerHandle;
    clearTimer(handle: TimerHandle): void;
    now(): number;
}
export interface MonitorBatcherOptions {
    batchMaxLines: number;
    batchMaxBytes: number;
    flushIntervalMs: number;
    scheduler?: SchedulerDeps;
}
export declare class MonitorBatcher {
    private readonly batchMaxLines;
    private readonly batchMaxBytes;
    private readonly flushIntervalMs;
    private readonly scheduler;
    private readonly lines;
    private batchCallback;
    private batchSeq;
    private pendingBytes;
    private firstPendingAt;
    private timer;
    private destroyed;
    constructor(opts: MonitorBatcherOptions);
    push(line: OutputLine): void;
    flushNow(options?: {
        allowEmpty?: boolean;
    }): void;
    onBatch(cb: (batch: OutputBatch) => void): void;
    pendingCount(): number;
    destroy(): void;
    private startTimer;
    private clearTimer;
}
