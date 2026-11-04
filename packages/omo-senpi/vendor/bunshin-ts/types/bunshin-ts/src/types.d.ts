import type { HubPolicy, BridgeRoute as RoutePreference } from "../../protocol/src/index.ts";
import type { MachineFindQuery } from "../../protocol/src/machine-lookup.ts";
import type { MachineToolDefinition } from "../../protocol/src/manifest-tools.ts";
import type { OperationMetadata } from "../../protocol/src/op-id.ts";
import type { Route } from "../../protocol/src/routes.ts";
import type { ArtifactRef, Constraint } from "../../protocol/src/capability.ts";
import type { TerminalExecArgs, TerminalKillArgs, TerminalKillResult, TerminalResult, TerminalWaitArgs, TerminalWriteArgs } from "../../protocol/src/mesh.ts";
import type { ShellResult } from "../../protocol/src/terminal.ts";
import type { CommandHandle, SpawnOptions } from "./command-handle.ts";
import type { FanoutContext, FanoutOptions, FanoutRun, FanoutTarget } from "./fanout-types.ts";
import type { FleetEventOptions, FleetEventSource } from "./fleet-events.ts";
/** A machine's hub-managed policy (tags, alias, PATH additions, shell budget, bridge switches). */
export type DevicePolicy = Omit<HubPolicy, "kind">;
/** Which transport produced a machine proxy. */
export type MachineTransportKind = "relay" | "hub";
/** Requester-local operator preferences (`~/.bunshin/operator.json` for the hub transport). */
export type BunshinOperatorConfig = {
    readonly bridges?: {
        /** Requester-local direct-only preference when false. Default true. */
        readonly enabled?: boolean;
        /** Include bridged rows in broad fanout selections. Default false. */
        readonly fanout?: boolean;
    };
    readonly aliases: Readonly<Record<string, string>>;
    readonly defaultTag?: string;
    readonly fanoutDefaults?: {
        readonly tag?: string;
        readonly concurrency?: number;
        readonly dedup?: "none" | "first" | "reject";
    };
};
/** Normalized routing fields shared by directory records and public proxies. */
export type MachineRouting = {
    readonly kind: "enrolled" | "bridged";
    readonly via?: string;
    readonly routes: readonly Route[];
    readonly connection: "hub" | "relay" | "ssh" | "none";
    readonly identityConflict?: boolean;
};
/** Custom transports may still supply pre-bridge records. Partial modern routing records are not accepted. */
type LegacyMachineRouting = {
    readonly kind?: never;
    readonly via?: never;
    readonly routes?: never;
    readonly connection?: never;
    readonly identityConflict?: never;
};
/** The directory's description of one machine, routing aside. */
type MachineRowFields = {
    readonly id: string;
    readonly alias: string;
    readonly os: string;
    readonly arch: string;
    readonly tags: readonly string[];
    readonly policy?: DevicePolicy;
    /** Reachability at the last directory read. Offline machines stay projected so fanout can classify them
     *  instead of them silently disappearing (C-FANOUT-1). */
    readonly state: "online" | "offline";
    readonly lastActivityMs?: number;
    /** When the hub last saw the agent connect, or last completed a bridge probe. A bridged row has no
     *  activity clock, so this is the only freshness signal it carries. */
    readonly lastSeenMs?: number;
    readonly onlineBasis?: "activity" | "bridge-probe";
    /** Why the agent parked its retry loop, or `null` while it is healthy. */
    readonly attention?: string | null;
    readonly protocolFeatures?: readonly string[];
    /** Build identity from the agent's last capability manifest — its version plus the sha256 of the
     *  binary it is actually running, so a stale agent is visible instead of silently old. */
    readonly build?: Readonly<{
        version: string;
        binarySha256: string;
        onDiskSha256?: string;
        installPath?: string;
    }>;
    readonly host?: Readonly<{
        load1: number;
        cores: number;
    }>;
    readonly restartNeeded?: boolean;
    /** The transport reached this machine but it cannot run machine operations (an older build without them).
     *  Fanout skips it with reason `machine_unsupported` instead of dispatching. */
    readonly unsupported?: boolean;
};
export type StandaloneMachineRecord = (MachineRouting | LegacyMachineRouting) & MachineRowFields;
export type ShellOptions = {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly timeoutMs?: number;
};
export type ShellInput = string | ({
    readonly command: string;
} & ShellOptions);
export type ShellRequestPayload = {
    readonly kind: "shell";
    readonly command: string;
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly timeoutMs?: number;
    /** Agent-local spill-file stem derived from the invoke id; set by the TS agent dispatcher only,
     *  never by requesters (C-NOSHELL-1). Governs where oversized output lands under
     *  `$BUNSHIN_HOME/jobs/`. */
    readonly spillStem?: string;
};
export type AccountCredentials = {
    readonly accountId: string;
    readonly accountSecret: string;
};
export type CapabilityTokenMintInput = {
    readonly machineId: string;
    readonly allowedOps: readonly string[];
    readonly pathJail: string;
    readonly argConstraints?: Readonly<Record<string, Constraint>>;
    readonly taskId?: string;
    readonly ttlMs?: number;
    readonly notBefore?: number;
};
export type CapabilityTokenMintResult = {
    readonly token: string;
    readonly expiry: number;
};
export type MachineCallOptions = {
    /** Hub route preference; never part of the logical operation identity. */
    readonly route?: RoutePreference;
    readonly capabilityToken?: string;
    readonly taskId?: string;
    readonly opId?: string;
    /** Caller-owned cancellation, threaded through by adapters (e.g. senpi node invokeTool). */
    readonly signal?: AbortSignal;
};
export type MachineToolMethod = (args?: unknown, options?: MachineCallOptions) => Promise<unknown>;
/** Pinned wall-clock and RNG source. In a task context both are deterministic (seeded from the taskId) so a
 *  memoized re-drive re-computes byte-identical step args. */
export type StepClock = {
    now(): number;
    random(): number;
};
/** The per-step handle passed to a {@link StepFn}. `now()`/`random()` draws are recorded into the step opId, so a
 *  step that reads them still reproduces its identity on re-drive under the pinned clock. */
export type StepContext = {
    readonly taskId: string;
    readonly stepName: string;
    readonly opSeq: number;
    now(): number;
    random(): number;
};
export type StepFn<Result> = (context: StepContext) => Result | Promise<Result>;
/** One prior journal coordinate from a caller-owned `taskJournal()` snapshot — the seq an opId was recorded at. */
export type ReplayJournalEntry = {
    readonly opId: string;
    readonly opSeq: number;
};
export type MachineTaskOptions = {
    /** Prior per-task journal (`opId` to recorded coordinate) from the hub. A re-driven step whose seq maps to a
     *  DIFFERENT opId than the journal recorded aborts with a `LedgerMismatchError` rather than re-running the effect. */
    readonly journal?: ReadonlyMap<string, ReplayJournalEntry>;
    /** Override the pinned clock/RNG; defaults to a deterministic clock seeded from the taskId. */
    readonly clock?: StepClock;
};
export interface ReadHandle {
    readonly sha256: string;
    readonly size: number;
    readonly artifact?: ArtifactRef;
    fetch(): ReadableStream<Uint8Array>;
}
export type ProcessInfo = {
    readonly pid: number;
    readonly startedAtMs: number;
    readonly cpuTimeMs: number;
    readonly rssBytes: number;
    readonly command: string;
    readonly lastOpAtMs?: number;
};
/** Everything the directory says about a machine, with no operations attached. The proxy projects all of it,
 *  so a requester can read build identity, parked state and freshness from the row it already holds instead of
 *  re-fetching `/directory` by hand — which is exactly what the fleet deploy script had to do. */
export type MachineDirectoryFields = MachineRouting & MachineRowFields;
export interface StandaloneMachine extends MachineDirectoryFields {
    /** The transport this proxy's operations ride. */
    readonly transport: MachineTransportKind;
    message(topic: string, body: unknown): Promise<Readonly<{
        accepted: true;
        seq: number;
        inboxPath: string;
    }>>;
    shell(input: ShellInput, options?: ShellOptions, callOptions?: MachineCallOptions): Promise<ShellResult>;
    /** Start a command that outlives one invoke deadline; the handle polls, streams, and cleans it up. */
    spawn(command: string, options?: SpawnOptions): Promise<CommandHandle>;
    exec_command(args: TerminalExecArgs, callOptions?: MachineCallOptions): Promise<TerminalResult>;
    write_stdin(args: TerminalWriteArgs, callOptions?: MachineCallOptions): Promise<TerminalResult>;
    wait_for_command(args: TerminalWaitArgs, callOptions?: MachineCallOptions): Promise<TerminalResult>;
    kill_terminal(args: TerminalKillArgs, callOptions?: MachineCallOptions): Promise<TerminalKillResult>;
    /** Bytes, always. Streaming is explicit: `readHandle()`. */
    read(path: string, options?: {
        readonly limitBytes?: number;
    }, callOptions?: MachineCallOptions): Promise<Uint8Array>;
    /** A digest-verified streaming handle for the same read; composes into `write()` without draining. */
    readHandle(path: string, options?: {
        readonly limitBytes?: number;
    }, callOptions?: MachineCallOptions): Promise<ReadHandle>;
    readText(path: string, options?: {
        readonly limitBytes?: number;
    }, callOptions?: MachineCallOptions): Promise<string>;
    readBytes(path: string, options?: {
        readonly limitBytes?: number;
    }, callOptions?: MachineCallOptions): Promise<Uint8Array>;
    pushTree(localDir: string, remotePath: string, options?: {
        readonly ignore?: readonly string[];
        readonly clean?: boolean;
    }, callOptions?: MachineCallOptions): Promise<unknown>;
    pullTree(remotePath: string, localDir: string, options?: {
        readonly ignore?: readonly string[];
        readonly include?: readonly string[];
    }, callOptions?: MachineCallOptions): Promise<unknown>;
    write(path: string, content: string | Uint8Array | ReadHandle, options?: {
        readonly createParentDirs?: boolean;
    }, callOptions?: MachineCallOptions): Promise<unknown>;
    glob(pattern: string, options?: {
        readonly limit?: number;
    }, callOptions?: MachineCallOptions): Promise<unknown>;
    grep(path: string, pattern: string, options?: {
        readonly limit?: number;
    }, callOptions?: MachineCallOptions): Promise<unknown>;
    edit(path: string, spec: {
        readonly exact: string;
        readonly replacement: string;
    }, callOptions?: MachineCallOptions): Promise<unknown>;
    processInfo(args?: {
        readonly pid?: number;
        readonly handleId?: string;
    }, callOptions?: MachineCallOptions): Promise<ProcessInfo>;
    restartAgent(args?: {
        readonly reason?: string;
    }, callOptions?: MachineCallOptions): Promise<{
        readonly scheduledInMs: number;
        readonly pid: number;
    }>;
    invoke(capability: string, args?: unknown, callOptions?: MachineCallOptions): Promise<unknown>;
    tool(capability: string): MachineToolMethod | undefined;
    /** Bind a serialized grant to every operation issued through the returned machine proxy. */
    withToken(token: string): StandaloneMachine;
    /** Bind a durable task context (pinned clock/RNG seeded from taskId) enabling opt-in step() memoization. */
    withTask(taskId: string, options?: MachineTaskOptions): TaskScopedMachine;
    /** Opt-in memoized-re-drive idiom. Requires a task context (see {@link StandaloneMachine.withTask}); a call on an
     *  unbound machine throws `TaskContextRequiredError`. */
    step<Result>(name: string, fn: StepFn<Result>): Promise<Result>;
}
/** A machine bound to a task context. Adds a read-only view of the opIds this task's completed steps produced —
 *  the client-side mirror of the hub per-task journal. */
export interface TaskScopedMachine extends StandaloneMachine {
    withToken(token: string): TaskScopedMachine;
    taskJournal(): readonly ReplayJournalEntry[];
}
/** Outcome of the public durable-result lookup: 202 → still running, 200 → the terminal frame's
 *  result payload (C-NORESULT-1). A 404 (unknown/expired) rejects with a typed transport error. */
export type DurableResultStatus = {
    readonly state: "in-flight";
} | {
    readonly state: "terminal";
    readonly result: unknown;
};
export type DurableArtifactResolver = (ref: ArtifactRef) => Promise<{
    readonly ref: ArtifactRef;
    readonly signal: AbortSignal;
}>;
/** Wire metadata adds routing without changing shared operation-identity coordinates. */
export type MachineOperationMetadata = OperationMetadata & Pick<MachineCallOptions, "route">;
/** Why an explicit route preference cannot carry `capability`, in the hub's own vocabulary, or `undefined` when the
 *  transport has no more specific word than a missing capability. */
export type RouteRefusalExplainer = (machine: StandaloneMachineRecord & MachineRouting, capability: string, preference: RoutePreference) => string | undefined;
/** Credential lifetime a transport exposes so the facade can renew it before a directory read. */
export type TransportCredentialRefresh = {
    readonly refreshBeforeExpiryMs: number;
    readonly expiresAtMs: () => number;
    readonly refreshSession: () => Promise<void>;
};
/**
 * Everything the client (facade, machine proxies, machine operations, command handles, the read family and fanout)
 * needs from a transport. `connect()` must be idempotent: `connect({ transport })` opens the transport before it
 * builds the hub so the transport's own errors surface unwrapped, and the hub calls it again.
 */
export interface MachineHubTransport {
    /** Which transport this is; projected onto every machine proxy as `transport`. Defaults to `"hub"`. */
    readonly kind?: MachineTransportKind;
    /** Transport-native durable result normalization, when supported. */
    readonly normalizesDurableResults?: true;
    readonly resolveArtifact?: DurableArtifactResolver;
    /** Session-authenticated fetch for artifact bodies; the client binds it to the transport before use. */
    readonly fetchArtifact?: typeof fetch;
    uploadArtifact?(bytes: Uint8Array): Promise<ArtifactRef>;
    connect(): Promise<void>;
    close(): Promise<void>;
    listMachines(): Promise<readonly StandaloneMachineRecord[]>;
    listTools(machineId: string): Promise<readonly MachineToolDefinition[]>;
    invoke(machineId: string, capability: string, args?: unknown, metadata?: MachineOperationMetadata, terminalTimeoutMs?: number, 
    /** The caller's cancellation (`MachineCallOptions.signal`, or a fanout target's timeout signal). A transport
     *  that can cancel an in-flight operation does so when it aborts; others may ignore it. */
    signal?: AbortSignal): Promise<unknown>;
    /** Mint a capability token for `withToken`. Used when `connectMachineHub` is not given its own minter. */
    mintCapabilityToken?(input: CapabilityTokenMintInput): Promise<CapabilityTokenMintResult>;
    /** Explain an explicit-route refusal (hub bridges); without it the refusal is a `CapabilityUnavailableError`. */
    readonly explainRouteRefusal?: RouteRefusalExplainer;
    /** Credential lifetime the facade renews before directory and policy reads. */
    readonly credentialRefresh?: TransportCredentialRefresh;
    /** Pull one request's state from the durable `/results` route when the transport exposes it. */
    resultOf?(requestId: string): Promise<DurableResultStatus>;
    /** Subscribe to requester fleet events (`hub.subscribe` / `hub.event`). */
    events?(options: FleetEventOptions): FleetEventSource;
    setPolicy?(machineId: string, policy: DevicePolicy): Promise<DevicePolicy>;
    getPolicy?(machineId: string): Promise<DevicePolicy>;
}
export interface StandaloneMachineHub {
    listMachines(): readonly StandaloneMachine[];
    getMachine(idOrAlias: string): StandaloneMachine;
    findMachine(query: MachineFindQuery): readonly StandaloneMachine[];
    listTools(idOrAlias: string): readonly MachineToolDefinition[];
    refresh(): Promise<void>;
    setPolicy(machineId: string, policy: DevicePolicy): Promise<DevicePolicy>;
    getPolicy(machineId: string): Promise<DevicePolicy>;
    mintCapabilityToken(input: CapabilityTokenMintInput): Promise<CapabilityTokenMintResult>;
    /** Recovery entry point: pull one request's terminal state from the durable `/results` route
     *  (202 in-flight, 200 terminal, 404 rejects typed — C-NORESULT-1). */
    resultOf(requestId: string): Promise<DurableResultStatus>;
    events(options: FleetEventOptions): FleetEventSource;
    close(): Promise<void>;
}
export type ConnectMachineHubOptions = {
    readonly transport: MachineHubTransport;
    /** Overrides the transport's own broker lookup; without either, a durable envelope cannot be resolved. */
    readonly resolveArtifact?: DurableArtifactResolver;
    /** Overrides the transport's own minter for `mintCapabilityToken`. */
    readonly mintCapabilityToken?: (input: CapabilityTokenMintInput) => Promise<CapabilityTokenMintResult>;
};
/**
 * The zero-ceremony requester client returned by `connect()` and the lazy `bunshin` default. Selectors
 * are async: `listMachines()`/`findMachine()` each read the directory fresh; `getMachine()` serves the
 * last discovery and reads only on a miss. `findMachine` resolves to exactly one machine or throws
 * `AmbiguousMachineLookupError` (>1) / `MachineNotFoundError` (0, definitive only after a fresh read).
 */
export interface BunshinClient {
    setPolicy(machineId: string, policy: DevicePolicy): Promise<DevicePolicy>;
    getPolicy(machineId: string): Promise<DevicePolicy>;
    listMachines(): Promise<readonly StandaloneMachine[]>;
    /** Awaiting the run gives the `FanoutResult` in input order; iterating it yields each outcome as it settles. */
    fanout<T>(targets: readonly FanoutTarget[] | {
        readonly tag: string;
    } | "all", fn: (machine: StandaloneMachine, context: FanoutContext) => Promise<T>, options?: FanoutOptions): FanoutRun<T>;
    getMachine(idOrAlias: string): Promise<StandaloneMachine>;
    findMachine(query: MachineFindQuery): Promise<StandaloneMachine>;
    listTools(idOrAlias: string): Promise<readonly MachineToolDefinition[]>;
    /** Recovery entry point for a durable request whose invoke promise the caller already lost: rides the
     *  hub `/results` route (202 in-flight, 200 terminal, typed 404 — C-NORESULT-1). */
    resultOf(requestId: string): Promise<DurableResultStatus>;
    events(options: FleetEventOptions): FleetEventSource;
    close(): Promise<void>;
}
export {};
