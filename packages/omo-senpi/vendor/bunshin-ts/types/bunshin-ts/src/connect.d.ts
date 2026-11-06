import { type BunshinFacadeOptions } from "./facade.ts";
import type { BunshinClient, BunshinOperatorConfig, DurableArtifactResolver, MachineHubTransport, StandaloneMachineHub, TransportCredentialRefresh } from "./types.ts";
export type BunshinConnectOptions = {
    /** The transport every machine operation rides (the hub transport, a relay transport, a test fake). */
    readonly transport: MachineHubTransport;
    /** Requester-local preferences: aliases, bridge switches, fanout defaults. */
    readonly operatorConfig?: BunshinOperatorConfig;
    readonly facade?: BunshinFacadeOptions;
    /** Overrides the transport's own artifact broker. */
    readonly resolveArtifact?: DurableArtifactResolver;
    /** Builds the client over the connected hub; a compatibility package passes its own facade here. */
    readonly createFacade?: (hub: StandaloneMachineHub, session: TransportCredentialRefresh | undefined, operatorConfig: BunshinOperatorConfig | undefined) => BunshinClient;
};
/**
 * Connect a client over any {@link MachineHubTransport}. The transport is opened first, so its own failures (a
 * refused session, an unreachable socket) reject unwrapped; the directory snapshot is then loaded and a failure
 * there closes the transport and rejects with `MachineHubConnectError`.
 */
export declare const connect: (options: BunshinConnectOptions) => Promise<BunshinClient>;
