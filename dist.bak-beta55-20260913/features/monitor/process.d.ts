export type TimerHandle = ReturnType<typeof setTimeout> | number;
export interface SpawnDeps {
    spawn?: SpawnFunction;
    setTimer: (fn: () => void, ms: number) => TimerHandle;
    clearTimer: (handle: TimerHandle) => void;
}
export interface MonitoredProcess {
    kill(signal?: NodeJS.Signals): void;
    exited: Promise<{
        code: number | null;
        signal: string | null;
    }>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
}
interface SpawnedMonitorProcess {
    readonly exited: Promise<number>;
    readonly stdout: ReadableStream<Uint8Array>;
    readonly stderr: ReadableStream<Uint8Array>;
    readonly pid?: number;
    readonly signalCode?: NodeJS.Signals | null;
}
type SpawnFunction = (argv: readonly string[], options: {
    readonly cwd?: string;
    readonly env?: Record<string, string>;
    readonly detached: boolean;
    readonly stdin: "ignore";
    readonly stdout: "pipe";
    readonly stderr: "pipe";
}) => SpawnedMonitorProcess;
export declare function spawnMonitoredProcess(opts: {
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    maxRuntimeMs: number;
}, deps: SpawnDeps): MonitoredProcess;
export {};
