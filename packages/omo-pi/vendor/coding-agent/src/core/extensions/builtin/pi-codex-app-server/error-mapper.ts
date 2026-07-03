export const ADAPTER_ERROR_SOURCE = "pi-codex-app-server";
export const ADAPTER_JSON_RPC_ERROR_CODE = -32080;

export type AdapterErrorCode =
	| "duplicate-routing-id"
	| "invalid-callback-state"
	| "incompatible-capabilities"
	| "invalid-session-state"
	| "malformed-message"
	| "unsupported-routing-method"
	| "unsupported-protocol-version"
	| "unsupported-notification-opt-out";

export interface AdapterJsonRpcError {
	readonly code: typeof ADAPTER_JSON_RPC_ERROR_CODE;
	readonly message: string;
	readonly data: {
		readonly source: typeof ADAPTER_ERROR_SOURCE;
		readonly adapterCode: AdapterErrorCode;
		readonly details: readonly string[];
		readonly retryable: boolean;
	};
}

export interface AppServerJsonRpcError {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

export interface AdapterJsonRpcErrorInput {
	readonly adapterCode: AdapterErrorCode;
	readonly message: string;
	readonly details?: readonly string[];
	readonly retryable?: boolean;
}

export function createAdapterJsonRpcError(input: AdapterJsonRpcErrorInput): AdapterJsonRpcError {
	return {
		code: ADAPTER_JSON_RPC_ERROR_CODE,
		message: input.message,
		data: {
			source: ADAPTER_ERROR_SOURCE,
			adapterCode: input.adapterCode,
			details: input.details ?? [],
			retryable: input.retryable ?? false,
		},
	};
}

export function preserveAppServerJsonRpcError(error: AppServerJsonRpcError): AppServerJsonRpcError {
	return error;
}
