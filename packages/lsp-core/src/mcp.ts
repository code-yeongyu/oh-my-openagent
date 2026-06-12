import type { Readable, Writable } from "node:stream";
import {
	errorResponse,
	isPlainRecord,
	jsonRpcId,
	messageFromError,
	runJsonRpcStdioServer,
	successResponse,
	type JsonRpcError,
	type JsonRpcId,
	type JsonRpcResponse,
	type JsonRpcResult,
	type McpToolDescriptor,
} from "@oh-my-opencode/mcp-stdio-core";
import { coerceToolArguments, executeLspTool, LSP_MCP_TOOLS } from "./tools.js";

export type { JsonRpcError, JsonRpcId, JsonRpcResponse, JsonRpcResult, McpToolDescriptor };

const SERVER_NAME = "lsp";
const SERVER_VERSION = "0.1.0";

export async function handleLspMcpRequest(input: unknown): Promise<JsonRpcResponse | undefined> {
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
		return handleToolCall(id, input["params"]);
	}

	return errorResponse(id, -32601, `Method not found: ${String(method)}`);
}

export async function runMcpStdioServer(
	input: Readable = process.stdin,
	output: Writable = process.stdout,
): Promise<void> {
	await runJsonRpcStdioServer({
		input,
		output,
		handler: handleLspMcpRequest,
		handlerOptions: undefined,
	});
}

async function handleToolCall(id: JsonRpcId, params: unknown): Promise<JsonRpcResponse> {
	if (!isPlainRecord(params) || typeof params["name"] !== "string") {
		return errorResponse(id, -32602, "tools/call requires params.name");
	}

	try {
		const result = await executeLspTool(params["name"], coerceToolArguments(params["arguments"]));
		return successResponse(id, {
			content: result.content,
			isError: result.isError ?? false,
			details: result.details,
		});
	} catch (error) {
		return successResponse(id, {
			content: [{ type: "text", text: messageFromError(error) }],
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
