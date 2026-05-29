import {
	DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS,
	errorResponse,
	isRecord,
	type JsonRpcId,
	type JsonRpcRequest,
	type JsonRpcResponse,
	jsonRpcId,
	type LazyMcpClock,
	type LazyMcpTimer,
	type McpToolDescriptor,
	messageFromError,
	requestedProtocolVersion,
	successResponse,
} from "./lazy-mcp-protocol.js";

export type {
	JsonRpcRequest,
	JsonRpcResponse,
	LazyMcpClock,
	LazyMcpTimer,
	McpToolDescriptor,
} from "./lazy-mcp-protocol.js";
export { DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS } from "./lazy-mcp-protocol.js";

export interface LazyMcpConnection {
	readonly closed: Promise<void>;
	request(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined>;
	stop(): Promise<void>;
}

export interface LazyMcpBackend {
	start(): Promise<LazyMcpConnection>;
}

export interface LazyMcpBackendProcessConfig {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
}

export interface LazyMcpBackendConfigResolution {
	readonly config: LazyMcpBackendProcessConfig;
	readonly warning?: string;
}

export interface LazyMcpProxy {
	handleRequest(input: unknown): Promise<JsonRpcResponse | undefined>;
	stopActiveBackend(): Promise<void>;
	hasActiveBackend(): boolean;
}

export interface LazyMcpProxyOptions {
	readonly backend: LazyMcpBackend;
	readonly clock?: LazyMcpClock;
	readonly idleTimeoutMs?: number;
	readonly log?: (event: string, fields?: Record<string, string | number | boolean | null>) => void;
	readonly serverName?: string;
	readonly serverVersion?: string;
	readonly toolDescriptors: readonly McpToolDescriptor[];
}

const defaultClock: LazyMcpClock = {
	setTimeout: (callback, delayMs) => createDefaultTimer(callback, delayMs),
	clearTimeout: (timer) => {
		if (isDefaultTimer(timer)) clearTimeout(timer.nodeTimer);
	},
};

export function createLazyMcpProxy(options: LazyMcpProxyOptions): LazyMcpProxy {
	return new LazyMcpProxyState(options);
}

export function resolveLazyLspBackendConfig(
	rawConfig: string | undefined,
	fallback: LazyMcpBackendProcessConfig,
): LazyMcpBackendConfigResolution {
	if (rawConfig === undefined || rawConfig.trim() === "") return { config: fallback };
	try {
		const parsed: unknown = JSON.parse(rawConfig);
		if (isBackendProcessConfig(parsed)) return { config: parsed };
		return malformedConfig(fallback, "config shape is invalid");
	} catch (error) {
		return malformedConfig(fallback, messageFromError(error));
	}
}

class LazyMcpProxyState implements LazyMcpProxy {
	private activeConnection: LazyMcpConnection | undefined;
	private idleTimer: LazyMcpTimer | undefined;
	private starting: Promise<LazyMcpConnection> | undefined;

	private readonly backend: LazyMcpBackend;
	private readonly clock: LazyMcpClock;
	private readonly idleTimeoutMs: number;
	private readonly log: NonNullable<LazyMcpProxyOptions["log"]>;
	private readonly serverName: string;
	private readonly serverVersion: string;
	private readonly toolDescriptors: readonly McpToolDescriptor[];

	constructor(options: LazyMcpProxyOptions) {
		this.backend = options.backend;
		this.clock = options.clock ?? defaultClock;
		this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS;
		this.log = options.log ?? (() => {});
		this.serverName = options.serverName ?? "lsp";
		this.serverVersion = options.serverVersion ?? "0.1.0";
		this.toolDescriptors = options.toolDescriptors;
	}

	async handleRequest(input: unknown): Promise<JsonRpcResponse | undefined> {
		if (!isRecord(input)) return errorResponse(null, -32600, "Invalid Request");
		const id = jsonRpcId(input["id"]);
		const method = input["method"];
		if (method === "notifications/initialized") return undefined;
		if (method === "ping") return successResponse(id, {});
		if (method === "initialize") return this.initialize(id, input["params"]);
		if (method === "tools/list") return successResponse(id, { tools: this.toolDescriptors });
		if (method === "resources/list") return successResponse(id, { resources: [] });
		if (method === "resources/templates/list") return successResponse(id, { resourceTemplates: [] });
		if (method === "tools/call") return this.handleToolCall(id, input);
		return errorResponse(id, -32601, `Method not found: ${String(method)}`);
	}

	async stopActiveBackend(): Promise<void> {
		this.clearIdleTimer();
		const connection = this.activeConnection;
		this.activeConnection = undefined;
		if (connection !== undefined) {
			await connection.stop();
			this.log("lazy_backend_stopped");
		}
	}

	hasActiveBackend(): boolean {
		return this.activeConnection !== undefined;
	}

	private initialize(id: JsonRpcId, params: unknown): JsonRpcResponse {
		return successResponse(id, {
			capabilities: { tools: { listChanged: false } },
			serverInfo: { name: this.serverName, version: this.serverVersion },
			protocolVersion: requestedProtocolVersion(params),
		});
	}

	private async handleToolCall(id: JsonRpcId, request: Record<string, unknown>): Promise<JsonRpcResponse> {
		try {
			const connection = await this.getConnection();
			const response = await connection.request({
				jsonrpc: "2.0",
				id,
				method: "tools/call",
				params: request["params"],
			});
			this.armIdleTimer();
			return response === undefined
				? errorResponse(id, -32603, "Lazy MCP backend returned no response")
				: withId(response, id);
		} catch (error) {
			return successResponse(id, {
				content: [{ type: "text", text: messageFromError(error) }],
				isError: true,
			});
		}
	}

	private async getConnection(): Promise<LazyMcpConnection> {
		if (this.activeConnection !== undefined) return this.activeConnection;
		if (this.starting !== undefined) return this.starting;
		const starting = this.startBackend();
		this.starting = starting;
		return starting;
	}

	private async startBackend(): Promise<LazyMcpConnection> {
		try {
			this.log("lazy_backend_starting");
			const connection = await this.backend.start();
			await connection.request({
				jsonrpc: "2.0",
				id: "lazy-mcp-initialize",
				method: "initialize",
				params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: this.serverName } },
			});
			this.activeConnection = connection;
			this.observeClose(connection);
			this.log("lazy_backend_started");
			return connection;
		} finally {
			this.starting = undefined;
		}
	}

	private observeClose(connection: LazyMcpConnection): void {
		void connection.closed.then(
			() => {
				if (this.activeConnection !== connection) return;
				this.activeConnection = undefined;
				this.clearIdleTimer();
				this.log("lazy_backend_stopped");
			},
			(error: unknown) => {
				this.log("lazy_backend_close_error", { message: messageFromError(error) });
			},
		);
	}

	private armIdleTimer(): void {
		this.clearIdleTimer();
		if (this.idleTimeoutMs <= 0) return;
		const timer = this.clock.setTimeout(() => {
			this.log("lazy_backend_idle_timeout", { idle_timeout_ms: this.idleTimeoutMs });
			void this.stopActiveBackend().catch((error: unknown) => {
				this.log("lazy_backend_idle_stop_error", { message: messageFromError(error) });
			});
		}, this.idleTimeoutMs);
		timer.unref?.();
		this.idleTimer = timer;
	}

	private clearIdleTimer(): void {
		if (this.idleTimer === undefined) return;
		this.clock.clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
	}
}

function malformedConfig(fallback: LazyMcpBackendProcessConfig, reason: string): LazyMcpBackendConfigResolution {
	return { config: fallback, warning: `Ignoring malformed lazy MCP backend config: ${reason}` };
}

function isBackendProcessConfig(value: unknown): value is LazyMcpBackendProcessConfig {
	if (!isRecord(value) || typeof value["command"] !== "string" || !isStringArray(value["args"])) return false;
	const cwd = value["cwd"];
	if (cwd !== undefined && typeof cwd !== "string") return false;
	const env = value["env"];
	return env === undefined || (isRecord(env) && Object.values(env).every((entry) => typeof entry === "string"));
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function withId(response: JsonRpcResponse, id: JsonRpcId): JsonRpcResponse {
	if (response.id === id) return response;
	if (response.error !== undefined) return { jsonrpc: "2.0", id, error: response.error };
	if (response.result !== undefined) return { jsonrpc: "2.0", id, result: response.result };
	return { jsonrpc: "2.0", id };
}

interface DefaultTimer extends LazyMcpTimer {
	readonly nodeTimer: ReturnType<typeof setTimeout>;
}

function createDefaultTimer(callback: () => void, delayMs: number): DefaultTimer {
	const nodeTimer = setTimeout(callback, delayMs);
	return { nodeTimer, unref: () => nodeTimer.unref() };
}

function isDefaultTimer(timer: LazyMcpTimer): timer is DefaultTimer {
	return isRecord(timer) && "nodeTimer" in timer;
}
