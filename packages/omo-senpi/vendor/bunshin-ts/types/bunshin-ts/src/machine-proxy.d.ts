import type { ShellResult } from "../../protocol/src/terminal.ts";
import type { MachineCallOptions, MachineRouting, MachineTaskOptions, MachineTransportKind, ReadHandle, ReplayJournalEntry, ShellRequestPayload, StandaloneMachine, StandaloneMachineRecord, StepFn } from "./types.ts";
/** The per-task memoization context a task-scoped proxy binds; owned by the client, referenced here by shape. */
export type ProxyTaskContext = {
    readonly taskId: string;
    runStep<Result>(name: string, fn: StepFn<Result>): Promise<Result>;
    snapshot(): readonly ReplayJournalEntry[];
    nextWireOpSeq(): number;
};
/** Internal call options: public overrides plus the task context a task-scoped proxy binds. The context always
 *  wins over a divergent `taskId` override so a task's opSeq stream can never be paired with a foreign taskId. */
export type BoundCallOptions = MachineCallOptions & {
    /** Bound requester preference, never overridable by per-call options. */
    readonly bridgesEnabled?: boolean;
    readonly taskContext?: ProxyTaskContext;
    /** Internal remaining budget for a lifecycle wait, not a new terminal wire argument. */
    readonly terminalTimeoutMs?: number;
};
/** The machine a host call addresses, plus the per-call options already merged with the proxy's bindings. */
type MachineCall = {
    readonly machineId: string;
    readonly callOptions?: BoundCallOptions | undefined;
};
export type InvokeCall = MachineCall & {
    readonly capability: string;
    readonly args?: unknown;
};
type ShellInvokeCall = MachineCall & {
    readonly capability: "shell";
    readonly args: ShellRequestPayload;
};
export type ReadCall = MachineCall & {
    readonly path: string;
    readonly options?: {
        readonly limitBytes?: number;
    } | undefined;
};
export type WriteCall = MachineCall & {
    readonly path: string;
    readonly content: string | Uint8Array | ReadHandle;
    readonly options?: {
        readonly createParentDirs?: boolean;
    } | undefined;
};
export type PushTreeCall = MachineCall & {
    readonly localDir: string;
    readonly remotePath: string;
    readonly options?: {
        readonly ignore?: readonly string[];
        readonly clean?: boolean;
    } | undefined;
};
export type PullTreeCall = MachineCall & {
    readonly remotePath: string;
    readonly localDir: string;
    readonly options?: {
        readonly ignore?: readonly string[];
        readonly include?: readonly string[];
    } | undefined;
};
/** Hub-side operations the proxies delegate to; supplied by the connected client that owns the transport. */
export type MachineProxyHost = {
    /** Projected onto every proxy as `transport`. */
    readonly transportKind: MachineTransportKind;
    invoke(call: ShellInvokeCall): Promise<ShellResult>;
    invoke(call: InvokeCall): Promise<unknown>;
    requireCapability(machineId: string, capability: string, callOptions?: BoundCallOptions): void;
    read(call: ReadCall): Promise<Uint8Array>;
    readHandle(call: ReadCall): Promise<ReadHandle>;
    readText(call: ReadCall): Promise<string>;
    pushTree(call: PushTreeCall): Promise<unknown>;
    pullTree(call: PullTreeCall): Promise<unknown>;
    write(call: WriteCall): Promise<unknown>;
    tool(machineId: string, capability: string, boundOptions: MachineCallOptions): ((args?: unknown, callOptions?: MachineCallOptions) => Promise<unknown>) | undefined;
    createTaskContext(taskId: string, options?: MachineTaskOptions): ProxyTaskContext;
    taskContextRequired(): never;
};
export type MachineRow = StandaloneMachineRecord & MachineRouting;
export declare const directOnlyMachine: (machine: StandaloneMachine) => StandaloneMachine;
/** The same machine with `signal` bound to every operation it issues (merged with any per-call signal). A machine
 *  this client did not build is returned unchanged: its operations only see the signal the caller passes. */
export declare const withCallSignal: (machine: StandaloneMachine, signal: AbortSignal) => StandaloneMachine;
export declare const machineProxy: (host: MachineProxyHost, record: MachineRow, boundOptions?: BoundCallOptions) => StandaloneMachine;
export {};
