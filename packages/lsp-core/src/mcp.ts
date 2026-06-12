import { createInterface } from "node:readline";

import { coerceToolArguments, executeLspTool, LSP_MCP_TOOLS, type TextContent } from "./tools.js";

export type JsonRpcId = string | number | null;

export interface McpToolDescriptor {
	name: string;
	title: string;
	description: string;
	inputSchema: unknown;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcResult {
	capabilities?: Record<string, unknown>;
	serverInfo?: Record<string, unknown>;
	protocolVersion?: string;
	tools?: McpToolDescriptor[];
	content?: TextContent[];
	isError?: boolean;
	[key: string]: unknown;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: JsonRpcId;
	result?: JsonRpcResult;
	error?: JsonRpcError;
}

const SERVER_NAME = "lsp";
const SERVER_VERSION = "0.1.0";

export async function handleLspMcpRequest(input: unknown): Promise<JsonRpcResponse | undefined> {
	if (!isRecord(input)) {
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
	input: NodeJS.ReadableStream = process.stdin,
	output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	for await (const line of lines) {
		if (!line.trim()) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			output.write(`${JSON.stringify(errorResponse(null, -32700, "Parse error", messageFromError(error)))}\n`);
			continue;
		}

		const response = await handleLspMcpRequest(parsed);
		if (response) output.write(`${JSON.stringify(response)}\n`);
	}
}

async function handleToolCall(id: JsonRpcId, params: unknown): Promise<JsonRpcResponse> {
	if (!isRecord(params) || typeof params["name"] !== "string") {
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

function successResponse(id: JsonRpcId, result: JsonRpcResult): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function requestedProtocolVersion(params: unknown): string {
	if (!isRecord(params) || typeof params["protocolVersion"] !== "string") return "2024-11-05";
	return params["protocolVersion"];
}

function jsonRpcId(value: unknown): JsonRpcId {
	return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
