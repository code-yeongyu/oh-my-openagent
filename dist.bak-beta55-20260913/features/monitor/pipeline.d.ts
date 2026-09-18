import type { MonitorBatcher } from "./batcher";
import type { LineStream } from "./line-stream";
import type { MonitorRingBuffer } from "./ring-buffer";
import type { MonitorCounters, OutputBatch, OutputStreamType } from "./types";
interface MonitorFilter {
    matches(text: string): boolean;
}
interface MonitorPipelineComponents {
    lineStream: Record<OutputStreamType, LineStream>;
    filter: MonitorFilter;
    ring: MonitorRingBuffer;
    batcher: MonitorBatcher;
}
interface MonitorPipelineDeps {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    log(error: unknown): void;
}
interface MonitorPipeline {
    onBatch(cb: (batch: OutputBatch) => void): void;
    counters(): MonitorCounters;
    isStopped(): boolean;
    stop(): void;
}
export declare function createMonitorPipeline(components: MonitorPipelineComponents, deps: MonitorPipelineDeps): MonitorPipeline;
export {};
