import type { MonitorCounters, MonitorOutputResult, OutputLine } from "./types";
type MonitorRingStream = "matched" | "unmatched" | "all";
interface MonitorRingBufferOptions {
    ringMaxLines: number;
}
interface MonitorRingQueryOptions {
    stream: MonitorRingStream;
    since_sequence?: number;
    limit?: number;
}
export declare class MonitorRingBuffer {
    private readonly ringMaxLines;
    private readonly matchedLines;
    private readonly unmatchedLines;
    private counters;
    constructor(opts: MonitorRingBufferOptions);
    push(line: OutputLine, matched: boolean): void;
    query(opts: MonitorRingQueryOptions): MonitorOutputResult;
    getCounters(): MonitorCounters;
    reset(): void;
    private pushMatched;
    private pushUnmatched;
    private selectLines;
}
export {};
