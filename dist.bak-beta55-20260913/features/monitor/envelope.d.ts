import type { MonitorCounters, OutputBatch } from "./types";
export declare function formatMonitorBatch(record: {
    id: string;
    label: string;
    command: string;
    status: string;
    exitCode?: number;
    signal?: string;
}, batch: OutputBatch, counters: MonitorCounters): string;
