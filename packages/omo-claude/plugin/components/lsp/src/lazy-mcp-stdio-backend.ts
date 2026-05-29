import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

import {
	isRecord,
	type JsonRpcId,
	type JsonRpcRequest,
	type JsonRpcResponse,
	type JsonRpcResult,
	jsonRpcId,
	messageFromError,
} from "./lazy-mcp-protocol.js";
import type { LazyMcpBackend, LazyMcpBackendProcessConfig, LazyMcpConnection } from "./lazy-mcp-proxy.js";

const FORCE_KILL_AFTER_MS = 1_000;

interface PendingRequest {
	readonly originalId: JsonRpcId;
	readonly reject: (error: Error) => void;
	readonly resolve: (response: JsonRpcResponse | undefined) => void;
}

export function createStdioLazyMcpBackend(config: LazyMcpBackendProcessConfig): LazyMcpBackend {
	return {
		start: async () => startStdioConnection(config),
	};
}

async function startStdioConnection(config: LazyMcpBackendProcessConfig): Promise<LazyMcpConnection> {
	const child = spawnBackend(config);
	return new StdioLazyMcpConnection(child);
}

class StdioLazyMcpConnection implements LazyMcpConnection {
	readonly closed: Promise<void>;

	private closedState = false;
	private nextRequestId = 1;
	private readonly pending = new Map<string, PendingRequest>();

	constructor(private readonly child: ChildProcessWithoutNullStreams) {
		this.closed = new Promise((resolve) => {
			const finish = (error?: Error) => {
				if (this.closedState) return;
				this.closedState = true;
				this.rejectPending(error ?? new Error("Lazy MCP backend exited"));
				resolve();
			};
			child.once("exit", () => finish());
			child.once("error", (error) => finish(error));
		});
		this.consumeStdout();
		child.stderr.on("data", (chunk: Buffer) => {
			process.stderr.write(chunk);
		});
	}

	async request(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
		if (this.closedState) throw new Error("Lazy MCP backend is not running");
		const upstreamId = `lazy-${this.nextRequestId}`;
		this.nextRequestId++;
		const upstreamRequest = { ...request, id: upstreamId };
		const response = new Promise<JsonRpcResponse | undefined>((resolve, reject) => {
			this.pending.set(upstreamId, { originalId: request.id ?? null, resolve, reject });
		});
		await this.writeLine(`${JSON.stringify(upstreamRequest)}\n`);
		return response;
	}

	async stop(): Promise<void> {
		if (this.closedState) return;
		this.child.kill("SIGTERM");
		const forceKill = setTimeout(() => {
			if (!this.closedState) this.child.kill("SIGKILL");
		}, FORCE_KILL_AFTER_MS);
		forceKill.unref();
		try {
			await this.closed;
		} finally {
			clearTimeout(forceKill);
		}
	}

	private consumeStdout(): void {
		const lines = createInterface({ input: this.child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
		void (async () => {
			try {
				for await (const line of lines) {
					this.handleLine(line);
				}
			} catch (error) {
				this.rejectPending(new Error(`Lazy MCP backend stdout failed: ${messageFromError(error)}`));
			}
		})();
	}

	private handleLine(line: string): void {
		if (!line.trim()) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			this.rejectPending(new Error(`Lazy MCP backend emitted invalid JSON: ${messageFromError(error)}`));
			return;
		}
		if (!isRecord(parsed)) return;
		const id = jsonRpcId(parsed["id"]);
		const pending = id === null ? undefined : this.pending.get(String(id));
		if (pending === undefined) return;
		this.pending.delete(String(id));
		pending.resolve(withOriginalId(parsed, pending.originalId));
	}

	private async writeLine(line: string): Promise<void> {
		if (this.child.stdin.write(line)) return;
		await once(this.child.stdin, "drain");
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}
}

function spawnBackend(config: LazyMcpBackendProcessConfig): ChildProcessWithoutNullStreams {
	const env = config.env === undefined ? process.env : { ...process.env, ...config.env };
	const stdio: ["pipe", "pipe", "pipe"] = ["pipe", "pipe", "pipe"];
	if (config.cwd === undefined) {
		return spawn(config.command, [...config.args], { env, stdio });
	}
	return spawn(config.command, [...config.args], { cwd: config.cwd, env, stdio });
}

function withOriginalId(value: Record<string, unknown>, id: JsonRpcId): JsonRpcResponse | undefined {
	const jsonrpc = value["jsonrpc"];
	if (jsonrpc !== "2.0") return undefined;
	const result = value["result"];
	const error = value["error"];
	if (isRecord(error) && typeof error["code"] === "number" && typeof error["message"] === "string") {
		return { jsonrpc, id, error: optionalErrorData(error) };
	}
	return isJsonRpcResult(result) ? { jsonrpc, id, result } : { jsonrpc, id };
}

function optionalErrorData(error: Record<string, unknown>): { code: number; message: string; data?: unknown } {
	const code = error["code"];
	const message = error["message"];
	if (typeof code !== "number" || typeof message !== "string") return { code: -32603, message: "Invalid MCP error" };
	if (!("data" in error)) return { code, message };
	return { code, message, data: error["data"] };
}

function isJsonRpcResult(value: unknown): value is JsonRpcResult {
	return isRecord(value);
}
