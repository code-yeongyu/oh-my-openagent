export declare class CapabilityUnavailableError extends Error {
    readonly machineId: string;
    readonly capability: string;
    constructor(machineId: string, capability: string);
}
export declare class CapabilityTokenMintError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string, options?: ErrorOptions);
}
declare class HubTransportError extends Error {
    readonly code: string;
    readonly requestId: string;
    readonly detail: unknown;
    readonly result: unknown;
    constructor(code: string, message: string, requestId?: string, detail?: unknown, result?: unknown);
}
type ProtocolErrorDisposition = "terminal" | "redeliverable";
export declare class MachineWireError extends HubTransportError {
    readonly disposition: ProtocolErrorDisposition | undefined;
    constructor(code: string, message: string, requestId?: string, disposition?: ProtocolErrorDisposition, detail?: unknown);
}
export {};
