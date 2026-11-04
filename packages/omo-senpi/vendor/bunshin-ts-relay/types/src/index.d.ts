import type { RelayStatusResult } from "./types.ts";
export { CapabilityTokenMintError, CapabilityUnavailableError, MachineWireError, } from "../vendor/bunshin-ts/errors.ts";
export { RelayTransportError, type RelayTransportErrorCode } from "./errors.ts";
export { createRelayTransport, SDK_TRANSPORT_VERSION, type RelayMachineHubTransport, type RelayTransportOptions, } from "./transport.ts";
export { OUTPUT_CREDIT_BYTES, type OutputItem, type RelayStatus, type RelayStatusResult, type StatusState, } from "./types.ts";
export declare const relayStatus: (options?: Readonly<{
    stateDir?: string;
}>) => Promise<RelayStatusResult>;
