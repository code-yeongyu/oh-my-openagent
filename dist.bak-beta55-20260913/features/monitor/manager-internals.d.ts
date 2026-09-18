import type { PluginInput } from "@opencode-ai/plugin";
import type { MonitorConfig } from "../../config/schema/monitor";
import { registerManagerForCleanup, unregisterManagerForCleanup } from "../background-agent/process-cleanup";
import { log } from "../../shared";
import type { InternalPromptDispatchArgs, PromptAsyncInput, PromptDispatchClient } from "@oh-my-opencode/utils/prompt-async-gate/types";
import { MonitorBatcher, type SchedulerDeps } from "./batcher";
import { createMonitorPipeline } from "./pipeline";
import { spawnMonitoredProcess, type MonitoredProcess } from "./process";
import { MonitorRingBuffer } from "./ring-buffer";
import type { MonitorId, MonitorRecord, OutputBatch } from "./types";
export type MonitorPipeline = ReturnType<typeof createMonitorPipeline>;
export type MonitorPromptClient = PromptDispatchClient & InternalPromptDispatchArgs<PromptAsyncInput>["client"];
export interface MonitorInjector {
    queueBatch(record: MonitorRecord, batch: OutputBatch): void;
    flushMonitor(monitorId: string): Promise<void>;
}
export interface InternalMonitorState {
    record: MonitorRecord;
    process: MonitoredProcess;
    ring: MonitorRingBuffer;
    batcher: MonitorBatcher;
    pipeline: MonitorPipeline;
    injector: MonitorInjector;
    stopped: boolean;
}
export interface MonitorManagerDeps {
    randomId?: () => MonitorId;
    isBackgroundSession?: (sessionId: string) => boolean;
    spawnMonitoredProcess?: typeof spawnMonitoredProcess;
    createInjector?: (record: MonitorRecord, scheduleFlush: (monitorId: string, delayMs: number, operation: () => Promise<void>) => void) => MonitorInjector;
    scheduler?: SchedulerDeps;
    registerManagerForCleanup?: typeof registerManagerForCleanup;
    unregisterManagerForCleanup?: typeof unregisterManagerForCleanup;
    log?: typeof log;
}
export interface MonitorManagerOptions {
    pluginContext: Pick<PluginInput, "client" | "directory">;
    config?: Partial<MonitorConfig>;
    deps?: MonitorManagerDeps;
}
export declare const DEFAULT_MONITOR_CONFIG: {
    max_monitors_per_session: number;
    max_runtime_ms: number;
    batch_max_lines: number;
    batch_max_bytes: number;
    flush_interval_ms: number;
    ring_max_lines: number;
    line_max_bytes: number;
    pattern_max_length: number;
};
export declare const MONITOR_OUTPUT_PENDING_RETRY_MS = 1000;
export declare const MONITOR_OUTPUT_ACCEPTED_MESSAGE_SKEW_MS = 5000;
export declare const MONITOR_OUTPUT_USER_MESSAGE_IN_PROGRESS_WINDOW_MS = 2000;
export declare const MONITOR_OUTPUT_POST_DISPATCH_HOLD_MS = 250;
export declare const MONITOR_OUTPUT_MAX_ACTIVE_DEFER_MS = 60000;
export declare function createEmptyCounters(): {
    totalLines: number;
    matchedLines: number;
    unmatchedLines: number;
    droppedMatched: number;
    droppedUnmatched: number;
    bytesDropped: number;
    lastSequence: number;
};
export declare function createRealScheduler(): SchedulerDeps;
export declare function createMonitorId(): MonitorId;
