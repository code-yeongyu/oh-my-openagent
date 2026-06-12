import type { Readable, Writable } from "node:stream";
import { jsonRpcId, runJsonRpcStdioServer, successResponse } from "@oh-my-opencode/mcp-stdio-core";
import { isPlainRecord } from "@oh-my-opencode/mcp-stdio-core/record";
import { handleLspMcpRequest, type JsonRpcId, type JsonRpcResponse } from "@oh-my-opencode/lsp-core/mcp";

import {
	type CallToolOptions,
	callToolViaDaemon,
	currentRequestContext,
	type DaemonToolContext,
} from "./daemon-client.js";
import { type DaemonPaths, daemonPaths } from "./paths.js";

export interface ProxyOptions {
	input?: Readable;
	output?: Writable;
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

	await runJsonRpcStdioServer({
		input,
		output,
		handler: handleProxyRequest,
		handlerOptions: callOptions,
		onHandlerError: (error: unknown) => {
			process.stderr.write(`[lsp-daemon] proxy error: ${error instanceof Error ? error.message : String(error)}\n`);
		},
	});
}

async function handleProxyRequest(parsed: unknown, callOptions: CallToolOptions): Promise<JsonRpcResponse | undefined> {
	const toolCall = asToolCall(parsed);
	if (!toolCall) return handleLspMcpRequest(parsed);

	const result = await callToolViaDaemon(toolCall.name, toolCall.args, callOptions);
	return successResponse(toolCall.id, { content: result.content, isError: result.isError ?? false, details: result.details });
}

function asToolCall(parsed: unknown): ToolCall | null {
	if (!isPlainRecord(parsed) || parsed["method"] !== "tools/call") return null;
	const params = parsed["params"];
	if (!isPlainRecord(params) || typeof params["name"] !== "string") return null;
	const args = params["arguments"];
	return { id: jsonRpcId(parsed["id"]), name: params["name"], args: isPlainRecord(args) ? args : {} };
}
