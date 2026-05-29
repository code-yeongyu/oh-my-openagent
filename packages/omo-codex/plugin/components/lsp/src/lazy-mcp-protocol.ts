export const DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS = 10 * 60_000;

export type JsonRpcId = string | number | null;
export type LazyMcpTimer = {
	unref?: () => void;
};

export interface LazyMcpClock {
	setTimeout(callback: () => void, delayMs: number): LazyMcpTimer;
	clearTimeout(timer: LazyMcpTimer): void;
}

export interface TextContent {
	readonly type: "text";
	readonly text: string;
}

export interface McpToolDescriptor {
	readonly name: string;
	readonly title?: string;
	readonly description?: string;
	readonly inputSchema: unknown;
}

export interface JsonRpcRequest {
	readonly jsonrpc?: "2.0";
	readonly id?: JsonRpcId;
	readonly method?: string;
	readonly params?: unknown;
}

export interface JsonRpcError {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

export interface JsonRpcResult {
	readonly capabilities?: Record<string, unknown>;
	readonly serverInfo?: Record<string, unknown>;
	readonly protocolVersion?: string;
	readonly tools?: readonly McpToolDescriptor[];
	readonly content?: readonly TextContent[];
	readonly isError?: boolean;
	readonly [key: string]: unknown;
}

export interface JsonRpcResponse {
	readonly jsonrpc: "2.0";
	readonly id: JsonRpcId;
	readonly result?: JsonRpcResult;
	readonly error?: JsonRpcError;
}

export function successResponse(id: JsonRpcId, result: JsonRpcResult): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

export function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

export function jsonRpcId(value: unknown): JsonRpcId {
	return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}

export function requestedProtocolVersion(params: unknown): string {
	if (!isRecord(params) || typeof params["protocolVersion"] !== "string") return "2024-11-05";
	return params["protocolVersion"];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function messageFromError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
