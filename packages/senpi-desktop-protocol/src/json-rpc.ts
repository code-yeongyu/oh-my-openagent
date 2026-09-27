import type { EngineMethod, EngineNotification, ErrorCode } from "./engine-schema.generated";
import type { AuditEvent, EngineLog, StopPathStatus } from "./wire";

/** A JSON-RPC request id: a number or a string, echoed verbatim by the engine. */
export type RequestId = number | string;

/** The `jsonrpc` member, always `"2.0"`. */
export type JsonRpcVersion = "2.0";

/** A client request; `id` is absent only for client notifications such as `$/cancel`. */
export interface JsonRpcRequest<P = unknown> {
	readonly jsonrpc: JsonRpcVersion;
	readonly id?: RequestId;
	readonly method: EngineMethod;
	readonly params?: P;
}

/** Why the engine answered a request with `-32601`. */
export type MethodRejection = "unknown" | "hostOnly" | "testOnly";

/** Error data carried by every `ErrorCode` failure. */
export interface EngineErrorData {
	readonly code: ErrorCode;
	/** Recovery hint for the model, e.g. `capture it again`. */
	readonly hint?: string | null;
}

/** Error data carried by every `-32601` rejection. */
export interface MethodRejectionData {
	readonly reason: MethodRejection;
}

export type JsonRpcErrorData = EngineErrorData | MethodRejectionData;

export interface JsonRpcError {
	readonly code: number;
	readonly message: string;
	readonly data?: JsonRpcErrorData | null;
}

export interface JsonRpcSuccess<R = unknown> {
	readonly jsonrpc: JsonRpcVersion;
	readonly id: RequestId;
	readonly result: R;
}

/** `id` is `null` only when the engine could not read the request id (parse error). */
export interface JsonRpcFailure {
	readonly jsonrpc: JsonRpcVersion;
	readonly id: RequestId | null;
	readonly error: JsonRpcError;
}

/** A reply to one request. */
export type JsonRpcResponse<R = unknown> = JsonRpcSuccess<R> | JsonRpcFailure;

/** Payload of each server-to-client notification; a schema notification without an entry fails to compile. */
export type EngineNotificationParams = {
	readonly audit: AuditEvent;
	readonly "stopPath.changed": StopPathStatus;
	readonly "engine.log": EngineLog;
};

/** A server-to-client notification, discriminated by `method`. */
export type JsonRpcNotification = {
	readonly [N in EngineNotification]: {
		readonly jsonrpc: JsonRpcVersion;
		readonly method: N;
		readonly params: EngineNotificationParams[N];
	};
}[EngineNotification];

/** JSON-RPC 2.0 standard error codes the engine emits. */
export const STANDARD_RPC_ERRORS = {
	parseError: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
} as const;
