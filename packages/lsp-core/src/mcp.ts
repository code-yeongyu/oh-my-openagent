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
const PROTOCOL_VERSIONS: readonly string[] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const SUPPORTED_VERSIONS = [MODERN_PROTOCOL_VERSION, ...PROTOCOL_VERSIONS];
const VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";
const CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";

export interface HandleLspMcpRequestOptions {
	readonly signal?: AbortSignal;
	readonly executeTool?: typeof executeLspTool;
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
	if (typeof input["method"] === "string" && !Object.hasOwn(input, "id")) return undefined;

	const id = jsonRpcId(input["id"]);
	const method = input["method"];
	const params = input["params"];
	const meta = isPlainRecord(params) && isPlainRecord(params["_meta"]) ? params["_meta"] : undefined;
	const hasProtocolMeta =
		meta !== undefined &&
		[VERSION_META_KEY, CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY].some((key) => Object.hasOwn(meta, key));
	const version = meta?.[VERSION_META_KEY];
	if (hasProtocolMeta || method === "server/discover") {
		if (typeof version !== "string" || !isPlainRecord(meta?.[CAPABILITIES_META_KEY])) {
			return errorResponse(id, -32602, "Protocol version and client capabilities are required in params._meta");
		}
		if (version !== MODERN_PROTOCOL_VERSION) {
			return errorResponse(id, -32022, "Unsupported protocol version", {
				supported: SUPPORTED_VERSIONS,
				requested: version,
			});
		}
	}
	const modern = version === MODERN_PROTOCOL_VERSION;
	const respond = (result: JsonRpcResult): JsonRpcResponse =>
		successResponse(
			id,
			modern
				? {
						...result,
						resultType: "complete",
						_meta: { "io.modelcontextprotocol/serverInfo": { name: SERVER_NAME, version: SERVER_VERSION } },
					}
				: result,
		);
	if (method === "server/discover") {
		return respond({
			supportedVersions: SUPPORTED_VERSIONS,
			capabilities: { tools: {} },
			ttlMs: 0,
			cacheScope: "public",
		});
	}
	if (modern && (method === "initialize" || method === "ping" || method === "notifications/initialized")) {
		return errorResponse(id, -32601, `Method not found: ${String(method)}`);
	}
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
		const tools = LSP_MCP_TOOLS.map(describeTool);
		return respond(modern ? { tools, ttlMs: 0, cacheScope: "public" } : { tools });
	}

	if (method === "tools/call") {
		const response = await handleToolCall(id, params, options);
		return response.result === undefined ? response : respond(response.result);
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
		// Idle stays disabled: hosts of this CLI (legacy opencode configs and
		// standalone lsp-tools-mcp users) have no evidenced respawn for an exited
		// stdio server; opencode in particular marks it failed without retry.
		idleTimeoutMs: 0,
		parentWatchdog: options.parentWatchdog ?? {},
		handler: (request) => runWithRequestContext(requestContext, () => handleLspMcpRequest(request)),
		handlerOptions: undefined,
	});
}

async function handleToolCall(
	id: JsonRpcId,
	params: unknown,
	options: HandleLspMcpRequestOptions,
): Promise<JsonRpcResponse> {
	if (!isPlainRecord(params) || typeof params["name"] !== "string") {
		return errorResponse(id, -32602, "tools/call requires params.name");
	}

	try {
		const result = await (options.executeTool ?? executeLspTool)(
			params["name"],
			coerceToolArguments(params["arguments"]),
			options.signal,
		);
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
	const requested = isPlainRecord(params) ? params["protocolVersion"] : undefined;
	return typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : "2025-06-18";
}
