import { type MachineFindQuery } from "../../protocol/src/machine-lookup.ts";
import type { MachineToolDefinition } from "../../protocol/src/manifest-tools.ts";
import { type FanoutDefaults } from "./fanout.ts";
import { FanoutRun } from "./fanout-run.ts";
import type { FanoutContext, FanoutOptions, FanoutTarget } from "./fanout-types.ts";
import type { FleetEventOptions, FleetEventSource } from "./fleet-events.ts";
import type { BunshinClient, BunshinOperatorConfig, DevicePolicy, DurableResultStatus, StandaloneMachine, StandaloneMachineHub, TransportCredentialRefresh } from "./types.ts";
/**
 * The zero-ceremony requester facade. Selectors are async by contract: `listMachines` and `findMachine`
 * are each backed by exactly one fresh directory read (no TTL cache); `getMachine` serves the last
 * discovery and re-reads once that snapshot is older than `directoryTtlMs` (default 30s) or on a miss, so
 * a not-found is definitive only after a fresh read.
 */
type BunshinSessionRefresh = TransportCredentialRefresh;
export type BunshinFacadeOptions = {
    /** How long a discovery snapshot may serve a `getMachine` hit before it is re-read. `0` re-reads on
     *  every hit; the default re-reads after 30s so a re-enrolled machine (same alias, new id) becomes
     *  visible without waiting for an unrelated miss (C-STALE-1). */
    readonly directoryTtlMs?: number;
    /** What a wave uses when it leaves `concurrency` or `cancelOnTimeout` unset. Default: no concurrency cap, and a
     *  timeout cancels its target. Operator `fanoutDefaults.concurrency` still overrides the concurrency default. */
    readonly fanoutDefaults?: Partial<FanoutDefaults>;
};
export declare class BunshinFacade implements BunshinClient {
    private readonly hub;
    private readonly session;
    private readonly operatorConfig;
    private readonly directoryTtlMs;
    private readonly fanoutDefaults;
    private snapshotLoadedAtMs;
    constructor(hub: StandaloneMachineHub, session?: BunshinSessionRefresh, operatorConfig?: BunshinOperatorConfig, options?: BunshinFacadeOptions);
    private refreshSessionIfNeeded;
    private refreshDirectory;
    listMachines(): Promise<readonly StandaloneMachine[]>;
    fanout<T>(targets: readonly FanoutTarget[] | {
        readonly tag: string;
    } | "all", fn: (machine: StandaloneMachine, context: FanoutContext) => Promise<T>, options?: FanoutOptions): FanoutRun<T>;
    getMachine(idOrAlias: string): Promise<StandaloneMachine>;
    findMachine(query: MachineFindQuery): Promise<StandaloneMachine>;
    listTools(idOrAlias: string): Promise<readonly MachineToolDefinition[]>;
    /** Recovery entry point for a durable request whose invoke promise the caller already lost (C-NORESULT-1). */
    resultOf(requestId: string): Promise<DurableResultStatus>;
    setPolicy(machineId: string, policy: DevicePolicy): Promise<DevicePolicy>;
    getPolicy(machineId: string): Promise<DevicePolicy>;
    events(options: FleetEventOptions): FleetEventSource;
    close(): Promise<void>;
    private selectedMachine;
    private resolveFanoutTargets;
}
export {};
