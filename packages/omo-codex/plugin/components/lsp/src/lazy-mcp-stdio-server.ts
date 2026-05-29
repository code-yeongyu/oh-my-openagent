import { createInterface } from "node:readline";

import { errorResponse, isRecord, type JsonRpcResponse, jsonRpcId, messageFromError } from "./lazy-mcp-protocol.js";
import type { LazyMcpProxy } from "./lazy-mcp-proxy.js";

export type LazyMcpLifecycleLog = (event: string, fields?: Record<string, string | number | boolean | null>) => void;

export interface LazyMcpStdioServerOptions {
	readonly log?: LazyMcpLifecycleLog;
}

const noopLog: LazyMcpLifecycleLog = () => {};

export async function runLazyMcpStdioServer(
	proxy: LazyMcpProxy,
	input: NodeJS.ReadableStream = process.stdin,
	output: NodeJS.WritableStream = process.stdout,
	options: LazyMcpStdioServerOptions = {},
): Promise<void> {
	const log = options.log ?? noopLog;
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	log("lazy_proxy_stdio_started", { cwd: process.cwd() });
	try {
		for await (const line of lines) {
			if (!line.trim()) continue;
			const response = await handleLine(proxy, line, log);
			if (response !== undefined) output.write(`${JSON.stringify(response)}\n`);
		}
	} finally {
		await proxy.stopActiveBackend();
		log("lazy_proxy_stdio_stopped");
	}
}

async function handleLine(
	proxy: LazyMcpProxy,
	line: string,
	log: LazyMcpLifecycleLog,
): Promise<JsonRpcResponse | undefined> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (error) {
		const message = messageFromError(error);
		log("lazy_proxy_parse_error", { message });
		return errorResponse(null, -32700, "Parse error", message);
	}
	const id = isRecord(parsed) ? jsonRpcId(parsed["id"]) : null;
	const method = isRecord(parsed) && typeof parsed["method"] === "string" ? parsed["method"] : null;
	log("lazy_proxy_request", { id: id === null ? null : String(id), method });
	const response = await proxy.handleRequest(parsed);
	if (response !== undefined) {
		log("lazy_proxy_response", { id: String(response.id), method, is_error: response.error !== undefined });
	}
	return response;
}
