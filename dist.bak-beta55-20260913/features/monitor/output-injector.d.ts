import type { MonitorOutputInjectorDeps } from "./output-injector-types";
import type { MonitorRecord, OutputBatch } from "./types";
export declare class MonitorOutputInjector {
    private readonly deps;
    private readonly pendingOutputs;
    private readonly dispatchedOutputs;
    private readonly deliveredSources;
    private readonly queuedAtBySource;
    constructor(deps: MonitorOutputInjectorDeps);
    queueBatch(record: MonitorRecord, batch: OutputBatch): void;
    getPendingBatches(monitorId: string): OutputBatch[];
    flushMonitor(monitorId: string): Promise<void>;
    private dispatchBatch;
    private requeueBatch;
    private isTerminalBatch;
    private hasTerminalBatchOverActiveDeferCeiling;
    private shouldForceActiveDispatch;
    private rememberQueuedAt;
    private getQueuedAgeMs;
    private isSessionActive;
    private settleAfterSessionIdle;
    private dispatchInternalPrompt;
    private scheduleFlush;
    private now;
    private trackDelivered;
    private createSource;
}
