import { describe, expect, it } from "vitest";

import {
	createLazyMcpProxy,
	DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS,
	type JsonRpcRequest,
	type JsonRpcResponse,
	type LazyMcpBackend,
	type LazyMcpClock,
	type LazyMcpConnection,
	type LazyMcpTimer,
	type McpToolDescriptor,
	resolveLazyLspBackendConfig,
} from "../src/lazy-mcp-proxy.js";

const toolDescriptors: readonly McpToolDescriptor[] = [
	{
		name: "diagnostics",
		title: "LSP Diagnostics",
		description: "Get diagnostics.",
		inputSchema: { type: "object", properties: {} },
	},
];

describe("lazy MCP proxy", () => {
	it("#given a lazy proxy #when tools are listed #then the backend MCP server is not started", async () => {
		// given
		const backend = new RecordingBackend();
		const proxy = createLazyMcpProxy({
			backend,
			clock: new ManualClock(),
			idleTimeoutMs: DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS,
			toolDescriptors,
		});

		// when
		const response = await proxy.handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });

		// then
		expect(toolNames(response)).toEqual(["diagnostics"]);
		expect(backend.startCalls).toBe(0);
	});

	it("#given a lazy proxy #when the first tool is called #then the backend starts and receives the call", async () => {
		// given
		const backend = new RecordingBackend();
		const proxy = createLazyMcpProxy({
			backend,
			clock: new ManualClock(),
			idleTimeoutMs: DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS,
			toolDescriptors,
		});

		// when
		const response = await proxy.handleRequest({
			jsonrpc: "2.0",
			id: "call-1",
			method: "tools/call",
			params: { name: "diagnostics", arguments: { filePath: "src/cli.ts" } },
		});

		// then
		const connection = backend.connections[0];
		expect(backend.startCalls).toBe(1);
		expect(connection?.methods()).toEqual(["initialize", "tools/call"]);
		expect(response).toMatchObject({
			jsonrpc: "2.0",
			id: "call-1",
			result: { isError: false },
		});
	});

	it("#given concurrent first calls #when the backend is still starting #then only one backend starts", async () => {
		// given
		const gate = createDeferred();
		const backend = new RecordingBackend(gate.promise);
		const proxy = createLazyMcpProxy({
			backend,
			clock: new ManualClock(),
			idleTimeoutMs: DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS,
			toolDescriptors,
		});

		// when
		const first = proxy.handleRequest({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "diagnostics", arguments: { filePath: "a.ts" } },
		});
		const second = proxy.handleRequest({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "diagnostics", arguments: { filePath: "b.ts" } },
		});

		// then
		expect(backend.startCalls).toBe(1);
		gate.resolve();
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		expect(backend.startCalls).toBe(1);
		expect(backend.connections[0]?.methods()).toEqual(["initialize", "tools/call", "tools/call"]);
	});

	it("#given an active lazy backend #when no tool call arrives for ten minutes #then the backend is stopped", async () => {
		// given
		const clock = new ManualClock();
		const backend = new RecordingBackend();
		const proxy = createLazyMcpProxy({
			backend,
			clock,
			idleTimeoutMs: DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS,
			toolDescriptors,
		});
		await proxy.handleRequest({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "diagnostics", arguments: { filePath: "src/cli.ts" } },
		});

		// when
		clock.advanceBy(DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS - 1);

		// then
		expect(backend.connections[0]?.stopCalls).toBe(0);

		// when
		clock.advanceBy(1);

		// then
		expect(backend.connections[0]?.stopCalls).toBe(1);
	});

	it("#given an active lazy backend #when a later call arrives #then the idle timeout is refreshed", async () => {
		// given
		const clock = new ManualClock();
		const backend = new RecordingBackend();
		const proxy = createLazyMcpProxy({
			backend,
			clock,
			idleTimeoutMs: DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS,
			toolDescriptors,
		});
		await proxy.handleRequest({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "diagnostics", arguments: { filePath: "first.ts" } },
		});
		clock.advanceBy(DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS - 1);

		// when
		await proxy.handleRequest({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "diagnostics", arguments: { filePath: "second.ts" } },
		});
		clock.advanceBy(1);

		// then
		expect(backend.connections[0]?.stopCalls).toBe(0);

		// when
		clock.advanceBy(DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS - 1);

		// then
		expect(backend.connections[0]?.stopCalls).toBe(1);
	});

	it("#given malformed optional backend config #when resolving lazy config #then the default backend is preserved", () => {
		// given
		const fallback = { command: "node", args: ["dist/cli.js", "mcp"], cwd: "/workspace" };

		// when
		const missing = resolveLazyLspBackendConfig(undefined, fallback);
		const malformed = resolveLazyLspBackendConfig("{", fallback);
		const wrongShape = resolveLazyLspBackendConfig(JSON.stringify({ command: 1, args: "mcp" }), fallback);

		// then
		expect(missing).toEqual({ config: fallback });
		expect(malformed.config).toEqual(fallback);
		expect(malformed.warning).toContain("Ignoring malformed lazy MCP backend config");
		expect(wrongShape.config).toEqual(fallback);
		expect(wrongShape.warning).toContain("Ignoring malformed lazy MCP backend config");
	});
});

class RecordingBackend implements LazyMcpBackend {
	startCalls = 0;
	readonly connections: RecordingConnection[] = [];

	constructor(private readonly beforeStartCompletes?: Promise<void>) {}

	async start(): Promise<LazyMcpConnection> {
		this.startCalls++;
		await this.beforeStartCompletes;
		const connection = new RecordingConnection();
		this.connections.push(connection);
		return connection;
	}
}

class RecordingConnection implements LazyMcpConnection {
	stopCalls = 0;
	readonly requests: JsonRpcRequest[] = [];
	readonly closed: Promise<void>;

	private resolveClosed: () => void = () => {};

	constructor() {
		this.closed = new Promise((resolve) => {
			this.resolveClosed = resolve;
		});
	}

	async request(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
		this.requests.push(request);
		return { jsonrpc: "2.0", id: request.id ?? null, result: { content: [], isError: false } };
	}

	async stop(): Promise<void> {
		this.stopCalls++;
		this.resolveClosed();
	}

	methods(): string[] {
		return this.requests.flatMap((request) => (typeof request.method === "string" ? [request.method] : []));
	}
}

class ManualClock implements LazyMcpClock {
	private nowMs = 0;
	private nextId = 1;
	private readonly timers = new Map<number, ManualTimer>();

	setTimeout(callback: () => void, delayMs: number): LazyMcpTimer {
		const timer = new ManualTimer(this.nextId, this.nowMs + delayMs, callback);
		this.nextId++;
		this.timers.set(timer.id, timer);
		return timer;
	}

	clearTimeout(timer: LazyMcpTimer): void {
		if (timer instanceof ManualTimer) {
			timer.clear();
			this.timers.delete(timer.id);
		}
	}

	advanceBy(delayMs: number): void {
		this.nowMs += delayMs;
		const dueTimers = [...this.timers.values()]
			.filter((timer) => timer.active && timer.dueAt <= this.nowMs)
			.sort((left, right) => left.dueAt - right.dueAt);
		for (const timer of dueTimers) {
			timer.clear();
			this.timers.delete(timer.id);
			timer.callback();
		}
	}
}

class ManualTimer {
	active = true;

	constructor(
		readonly id: number,
		readonly dueAt: number,
		readonly callback: () => void,
	) {}

	unref(): void {}

	clear(): void {
		this.active = false;
	}
}

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolveDeferred: () => void = () => {};
	const promise = new Promise<void>((resolve) => {
		resolveDeferred = resolve;
	});
	return { promise, resolve: resolveDeferred };
}

function toolNames(response: JsonRpcResponse | undefined): string[] {
	const tools = response?.result?.tools;
	if (!Array.isArray(tools)) return [];
	return tools.flatMap((tool) => {
		if (!isRecord(tool) || typeof tool["name"] !== "string") return [];
		return [tool["name"]];
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
