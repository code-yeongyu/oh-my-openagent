declare const RELAY_TRANSPORT_ERROR_CODES: readonly ["invalid_client_name", "not_connected", "server_proof_invalid", "insecure_state_dir", "refused", "request_timeout", "closed", "unsupported", "result_expired"];
export type RelayTransportErrorCode = (typeof RELAY_TRANSPORT_ERROR_CODES)[number];
export declare class RelayTransportError extends Error {
    readonly code: RelayTransportErrorCode;
    readonly requestId: string | undefined;
    constructor(code: RelayTransportErrorCode, message: string, cause?: unknown, requestId?: string);
}
export declare class WireRefusal extends Error {
    readonly code: string;
    readonly reason: string;
    constructor(code: string, reason: string);
}
export declare const transportErrorOf: (error: unknown) => unknown;
export {};
