import type { CapabilityTokenMintInput, CapabilityTokenMintResult, DevicePolicy, DurableResultStatus, FleetEventOptions, FleetEventSource, MachineHubTransport } from "../vendor/bunshin-ts/types.ts";
import type { DeadlineTimer, OutputItem, RelayStatus } from "./types.ts";
export declare const SDK_TRANSPORT_VERSION = "0.1.0";
export declare const DESCRIBE_TIMEOUT_MS = 10000;
export type RelayTransportOptions = Readonly<{
    stateDir?: string;
    clientName?: string;
    clientVersion?: string;
    sessionRef?: string;
    requestTimeoutMs?: number;
    describeTimeoutMs?: number;
    timer?: DeadlineTimer;
    reportError?: (error: unknown) => void;
}>;
export interface RelayMachineHubTransport extends MachineHubTransport {
    readonly kind: "relay";
    resultOf(requestId: string): Promise<DurableResultStatus>;
    events(options: FleetEventOptions): FleetEventSource;
    setPolicy(machineId: string, policy: DevicePolicy): Promise<DevicePolicy>;
    getPolicy(machineId: string): Promise<DevicePolicy>;
    mintCapabilityToken(input: CapabilityTokenMintInput): Promise<CapabilityTokenMintResult>;
    relayStatus(): Promise<RelayStatus>;
    output(handle: string): AsyncIterable<OutputItem>;
}
export declare const createRelayTransport: (options?: RelayTransportOptions) => RelayMachineHubTransport;
