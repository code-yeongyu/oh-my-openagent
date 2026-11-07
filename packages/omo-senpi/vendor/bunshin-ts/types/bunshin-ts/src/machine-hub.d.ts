import type { MachineFindQuery } from "../../protocol/src/machine-lookup.ts";
import type { MachineToolDefinition } from "../../protocol/src/manifest-tools.ts";
import type { ShellResult } from "../../protocol/src/terminal.ts";
import { type FleetEventOptions, type FleetEventSource } from "./fleet-events.ts";
import { type BoundCallOptions, type InvokeCall, type MachineProxyHost, type PullTreeCall, type PushTreeCall, type ReadCall, type WriteCall } from "./machine-proxy.ts";
import { TaskContext } from "./task-context.ts";
import type { CapabilityTokenMintInput, CapabilityTokenMintResult, ConnectMachineHubOptions, DevicePolicy, DurableResultStatus, MachineCallOptions, MachineTaskOptions, MachineTransportKind, ReadHandle, ShellRequestPayload, StandaloneMachine, StandaloneMachineHub, StandaloneMachineRecord } from "./types.ts";
export declare const connectMachineHub: (options: ConnectMachineHubOptions) => Promise<StandaloneMachineHub>;
/** One directory read: every machine and its tools. */
export type HubSnapshot = Readonly<{
    machines: readonly StandaloneMachineRecord[];
    tools: ReadonlyMap<string, readonly MachineToolDefinition[]>;
}>;
export declare class ConnectedMachineHub implements StandaloneMachineHub, MachineProxyHost {
    private readonly transport;
    private machines;
    private tools;
    readonly transportKind: MachineTransportKind;
    private readonly mint;
    /** Broker that mints artifact download URLs: an explicit option wins, else the transport's own resolver
     *  bound to its receiver so the call keeps its credentials. A durable RESULT envelope cannot be resolved
     *  without one (`DurableResultEnvelopeError`), because its URL is machine-supplied. */
    private readonly resolveArtifact;
    private readonly connectionTaskId;
    /** The read family's view of this hub: invoke, the capability table, the artifact broker and the
     *  session-authenticated fetch, with nothing else of the client exposed to it. */
    private readonly readDeps;
    /** The tree family's view of this hub: invoke, the tree-transfer gate, the uploading transport and the fetch. */
    private readonly treeDeps;
    private nextWireSeq;
    private nextAdhocWireSeq;
    constructor(options: ConnectMachineHubOptions, snapshot: HubSnapshot);
    listMachines(): readonly StandaloneMachine[];
    getMachine(idOrAlias: string): StandaloneMachine;
    findMachine(query: MachineFindQuery): readonly StandaloneMachine[];
    listTools(idOrAlias: string): readonly MachineToolDefinition[];
    refresh(): Promise<void>;
    mintCapabilityToken(input: CapabilityTokenMintInput): Promise<CapabilityTokenMintResult>;
    /** Recovery entry point: delegates to the transport's `/results` route when it exposes one (C-NORESULT-1). */
    resultOf(requestId: string): Promise<DurableResultStatus>;
    setPolicy(machineId: string, policy: DevicePolicy): Promise<DevicePolicy>;
    getPolicy(machineId: string): Promise<DevicePolicy>;
    events(options: FleetEventOptions): FleetEventSource;
    close(): Promise<void>;
    createTaskContext(taskId: string, options?: MachineTaskOptions): TaskContext;
    taskContextRequired(): never;
    pushTree(call: PushTreeCall): Promise<unknown>;
    pullTree(call: PullTreeCall): Promise<unknown>;
    private requireTreeTransfer;
    write(call: WriteCall): Promise<unknown>;
    /** Bytes, always: a caller that persists this result gets the file, never a handle object it forgot to
     *  recognise. `readHandle()` is the explicit streaming door. */
    read(call: ReadCall): Promise<Uint8Array>;
    readText(call: ReadCall): Promise<string>;
    /** The streaming face of `read`: a digest-verified handle that composes into `write()` without materialising
     *  the payload here. Inline reads get the same shape, so no caller has to branch on the file's size. */
    readHandle(call: ReadCall): Promise<ReadHandle>;
    invoke(call: InvokeCall & {
        readonly capability: "shell";
        readonly args: ShellRequestPayload;
    }): Promise<ShellResult>;
    invoke(call: InvokeCall): Promise<unknown>;
    tool(machineId: string, capability: string, boundOptions: BoundCallOptions): ((args?: unknown, callOptions?: MachineCallOptions) => Promise<unknown>) | undefined;
    requireCapability(machineId: string, capability: string, callOptions?: BoundCallOptions): void;
    /** An over-threshold `fs.read` hands back a reference to the content-addressed store (D10), NOT a durable
     *  result envelope: the URL is already a fetchable handle and every byte is digest-verified on the way out.
     *  A configured broker still takes precedence — it mints a session-scoped URL and the deadline that bounds
     *  the download — but its absence is not an error the way it is for an envelope, whose machine-supplied URL
     *  must never be trusted. */
    private resolveReadArtifact;
    /** Artifact bodies ride the transport's session-authenticated fetch when it exposes one; binding it keeps
     *  the credential attached to its receiver instead of an unbound function losing `this`. */
    private transportFetch;
    private routePreference;
    private hasCapability;
    private toolsFor;
    private resolve;
}
