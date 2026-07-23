import type { Readable, Writable } from "node:stream";
import {
	errorResponse,
	isPlainRecord,
	jsonRpcId,
	runJsonRpcStdioServer,
	successResponse,
	type JsonRpcError,
	type JsonRpcId,
	type JsonRpcResponse,
	type JsonRpcResult,
	type McpToolDescriptor,
	type ParentWatchdogConfig,
} from "@oh-my-opencode/mcp-stdio-core";
import { coerceToolArguments, executeLspTool, LSP_MCP_TOOLS } from "./tools.js";
import { createStandaloneMcpRequestContext, runWithRequestContext } from "./request-context.js";

export type { JsonRpcError, JsonRpcId, JsonRpcResponse, JsonRpcResult, McpToolDescriptor };

const SERVER_NAME = "lsp";
const SERVER_VERSION = "0.1.0";

export interface HandleLspMcpRequestOptions {
	readonly signal?: AbortSignal;
}

export interface LspMcpStdioServerOptions {
	// Test seam: production callers leave this unset so the watchdog uses its
	// defaults (parentPid = process.ppid, 30s poll).
	readonly parentWatchdog?: ParentWatchdogConfig;
}

export async function handleLspMcpRequest(
	input: unknown,
	options: HandleLspMcpRequestOptions = {},
): Promise<JsonRpcResponse | undefined> {
	if (!isPlainRecord(input)) {
		return errorResponse(null, -32600, "Invalid Request");
	}

	const id = jsonRpcId(input["id"]);
	const method = input["method"];
	if (method === "notifications/initialized") return undefined;
	if (method === "ping") return successResponse(id, {});
	if (method === "initialize") {
		const protocolVersion = requestedProtocolVersion(input["params"]);
		return successResponse(id, {
			capabilities: { tools: { listChanged: false } },
			serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
			protocolVersion,
		});
	}

	if (method === "tools/list") {
		return successResponse(id, { tools: LSP_MCP_TOOLS.map(describeTool) });
	}

	if (method === "tools/call") {
		return handleToolCall(id, input["params"], options.signal);
	}

	return errorResponse(id, -32601, `Method not found: ${String(method)}`);
}

export async function runMcpStdioServer(
	input: Readable = process.stdin,
	output: Writable = process.stdout,
	options: LspMcpStdioServerOptions = {},
): Promise<void> {
	const requestContext = createStandaloneMcpRequestContext();
	await runJsonRpcStdioServer({
		input,
		output,
		idleTimeoutMs: 0,
		parentWatchdog: options.parentWatchdog ?? {},
		handler: (request) => runWithRequestContext(requestContext, () => handleLspMcpRequest(request)),
		handlerOptions: undefined,
	});
}

async function handleToolCall(id: JsonRpcId, params: unknown, signal?: AbortSignal): Promise<JsonRpcResponse> {
	if (!isPlainRecord(params) || typeof params["name"] !== "string") {
		return errorResponse(id, -32602, "tools/call requires params.name");
	}

	try {
		const result = await executeLspTool(params["name"], coerceToolArguments(params["arguments"]), signal);
		return successResponse(id, {
			content: result.content,
			isError: result.isError ?? false,
			details: result.details,
		});
	} catch (error) {
		if (!(error instanceof Error)) {
			throw error;
		}
		return successResponse(id, {
			content: [{ type: "text", text: error.message }],
			isError: true,
		});
	}
}

function describeTool(tool: (typeof LSP_MCP_TOOLS)[number]): McpToolDescriptor {
	return {
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema: tool.inputSchema,
	};
}

function requestedProtocolVersion(params: unknown): string {
	if (!isPlainRecord(params) || typeof params["protocolVersion"] !== "string") return "2024-11-05";
	return params["protocolVersion"];
}
