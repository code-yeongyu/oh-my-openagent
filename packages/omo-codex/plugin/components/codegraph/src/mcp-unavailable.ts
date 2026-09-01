import type { Readable, Writable } from "node:stream";

import {
	errorResponse,
	isPlainRecord,
	jsonRpcId,
	runJsonRpcStdioServer,
	successResponse,
	type JsonRpcResponse,
	type McpLifecycleLog,
	type ParentWatchdogConfig,
} from "../../../../../mcp-stdio-core/src/index.ts";

export interface UnavailableCodegraphMcpOptions {
	readonly input: Readable;
	readonly output: Writable;
	readonly reason: string;
	readonly serverVersion: string;
	// Test seam: production callers leave this unset so the watchdog uses its
	// defaults (parentPid = process.ppid, 30s poll).
	readonly parentWatchdog?: ParentWatchdogConfig;
	// Test seam: surfaces the mcp-stdio-core lifecycle log so tests can pin the
	// resolved idle timeout without waiting a real timeout out.
	readonly lifecycleLog?: McpLifecycleLog;
}

interface UnavailableCodegraphMcpHandlerOptions {
	readonly reason: string;
	readonly serverVersion: string;
}

export async function runUnavailableCodegraphMcpServer(
	options: UnavailableCodegraphMcpOptions,
): Promise<void> {
	await runJsonRpcStdioServer({
		handler: handleUnavailableCodegraphMcpRequest,
		handlerOptions: {
			reason: options.reason.trim(),
			serverVersion: options.serverVersion,
		},
		input: options.input,
		output: options.output,
		// Idle stays disabled: the codex host never respawns an exited stdio
		// MCP server (codex-rs auto-reconnects only its own codex_apps server),
		// and since #6548 the default idle timer actually destroys stdin — so an
		// inherited 10-minute default would silently kill this stub mid-session
		// and turn later codegraph tool calls into dead-connection errors.
		idleTimeoutMs: 0,
		parentWatchdog: options.parentWatchdog ?? {},
		// Conditional spread keeps this assignable under exactOptionalPropertyTypes.
		...(options.lifecycleLog === undefined ? {} : { log: options.lifecycleLog }),
	});
}

async function handleUnavailableCodegraphMcpRequest(
	input: unknown,
	options: UnavailableCodegraphMcpHandlerOptions,
): Promise<JsonRpcResponse | undefined> {
	if (!isPlainRecord(input)) {
		return errorResponse(null, -32600, "Invalid Request");
	}

	const id = jsonRpcId(input["id"]);
	const method = input["method"];
	if (method === "notifications/initialized") return undefined;
	if (method === "ping") return successResponse(id, {});
	if (method === "initialize") {
		return successResponse(id, {
			capabilities: { tools: { listChanged: false } },
			protocolVersion: requestedProtocolVersion(input["params"]),
			serverInfo: { name: "codegraph", version: options.serverVersion },
		});
	}

	if (method === "tools/list") {
		return successResponse(id, { tools: [] });
	}

	if (method === "tools/call") {
		return successResponse(id, {
			content: [{ text: options.reason, type: "text" }],
			isError: true,
		});
	}

	return errorResponse(id, -32601, `Method not found: ${String(method)}`);
}

function requestedProtocolVersion(params: unknown): string {
	if (!isPlainRecord(params) || typeof params["protocolVersion"] !== "string") return "2024-11-05";
	return params["protocolVersion"];
}
