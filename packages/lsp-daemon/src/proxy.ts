import { createInterface } from "node:readline";

import { handleLspMcpRequest, type JsonRpcId, type JsonRpcResponse } from "@code-yeongyu/lsp-tools-mcp/dist/mcp.js";

import {
	type CallToolOptions,
	callToolViaDaemon,
	currentRequestContext,
	type DaemonToolContext,
} from "./daemon-client.js";
import { type DaemonPaths, daemonPaths } from "./paths.js";

export interface ProxyOptions {
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
	paths?: DaemonPaths;
	context?: DaemonToolContext;
	ensure?: CallToolOptions["ensure"];
}

interface ToolCall {
	id: JsonRpcId;
	name: string;
	args: Record<string, unknown>;
}

export async function runMcpStdioProxy(options: ProxyOptions = {}): Promise<void> {
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stdout;
	const paths = options.paths ?? daemonPaths();
	const context = options.context ?? currentRequestContext();
	const callOptions: CallToolOptions = { paths, context, ...(options.ensure ? { ensure: options.ensure } : {}) };

	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	for await (const line of lines) {
		if (!line.trim()) continue;
		try {
			const response = await handleLine(line, callOptions);
			if (response) output.write(`${JSON.stringify(response)}\n`);
		} catch (error) {
			process.stderr.write(`[lsp-daemon] proxy error: ${error instanceof Error ? error.message : String(error)}\n`);
		}
	}
}

async function handleLine(line: string, callOptions: CallToolOptions): Promise<JsonRpcResponse | undefined> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (error) {
		return parseErrorResponse(error);
	}

	const toolCall = asToolCall(parsed);
	if (!toolCall) return handleLspMcpRequest(parsed);

	const result = await callToolViaDaemon(toolCall.name, toolCall.args, callOptions);
	return {
		jsonrpc: "2.0",
		id: toolCall.id,
		result: { content: result.content, isError: result.isError ?? false, details: result.details },
	};
}

function asToolCall(parsed: unknown): ToolCall | null {
	if (!isRecord(parsed) || parsed["method"] !== "tools/call") return null;
	const params = parsed["params"];
	if (!isRecord(params) || typeof params["name"] !== "string") return null;
	const args = params["arguments"];
	return { id: jsonRpcId(parsed["id"]), name: params["name"], args: isRecord(args) ? args : {} };
}

function jsonRpcId(value: unknown): JsonRpcId {
	return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}

function parseErrorResponse(error: unknown): JsonRpcResponse {
	const message = error instanceof Error ? error.message : String(error);
	return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error", data: message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
