import type { PluginInput } from "@opencode-ai/plugin";
import { log } from "../../shared";
import type { MonitorBatcher } from "./batcher";
import type { DEFAULT_MONITOR_CONFIG, InternalMonitorState, MonitorInjector, MonitorManagerDeps } from "./manager-internals";
import { type MonitoredProcess } from "./process";
import { MonitorRingBuffer } from "./ring-buffer";
import type { MonitorRecord } from "./types";
interface MonitorStateFactoryInput {
    record: MonitorRecord;
    monitoredProcess: MonitoredProcess;
    filter: {
        matches(text: string): boolean;
    };
    ring: MonitorRingBuffer;
    batcher: MonitorBatcher;
    injector: MonitorInjector;
    config: typeof DEFAULT_MONITOR_CONFIG;
    logger: typeof log;
}
export declare function createMonitorState(input: MonitorStateFactoryInput): InternalMonitorState;
export declare function observeProcessExit(state: InternalMonitorState, logger: typeof log, onTerminal: (parentSessionId: string) => void): void;
export declare function spawnMonitorProcess(deps: MonitorManagerDeps | undefined, command: string, maxRuntimeMs: number): MonitoredProcess;
export declare function createMonitorInjector(deps: MonitorManagerDeps | undefined, pluginContext: Pick<PluginInput, "client" | "directory">, record: MonitorRecord, scheduleFlush: (monitorId: string, delayMs: number, operation: () => Promise<void>) => void): MonitorInjector;
export {};
