import type { Readable, Writable } from "node:stream";

import {
	errorResponse,
	isPlainRecord,
	jsonRpcId,
	runJsonRpcStdioServer,
	successResponse,
	type JsonRpcResponse,
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
		parentWatchdog: options.parentWatchdog ?? {},
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
