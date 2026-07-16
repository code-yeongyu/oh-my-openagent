import { existsSync, realpathSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute } from "node:path";
import type { Readable, Writable } from "node:stream";
import { handleLspMcpRequest, type JsonRpcId, type JsonRpcResponse } from "@oh-my-opencode/lsp-core/mcp";
import { createStandaloneMcpRequestContext, runWithRequestContext } from "@oh-my-opencode/lsp-core/request-context";
import { jsonRpcId, runJsonRpcStdioServer, successResponse } from "@oh-my-opencode/mcp-stdio-core";
import { isPlainRecord } from "@oh-my-opencode/mcp-stdio-core/record";

import { type CallToolOptions, callToolViaDaemon, type DaemonToolContext } from "./daemon-client.js";
import { type DaemonPaths, daemonPaths } from "./paths.js";

export interface ProxyOptions {
	input?: Readable;
	output?: Writable;
	stderr?: Writable;
	paths?: DaemonPaths;
	context?: DaemonToolContext;
	cwd?: string;
	env?: Record<string, string | undefined>;
	homeDir?: string;
	ensure?: CallToolOptions["ensure"];
	startupTimeoutMs?: number;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

interface ToolCall {
	id: JsonRpcId;
	name: string;
	args: Record<string, unknown>;
}

export async function runMcpStdioProxy(options: ProxyOptions = {}): Promise<void> {
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
	const lifecycleController = new AbortController();
	const abortFromInput = (): void => lifecycleController.abort();
	let startupExpired = false;
	let startupTimer: ReturnType<typeof setTimeout> | undefined;
	const clearStartupWatchdog = (): void => {
		if (startupTimer === undefined) return;
		clearTimeout(startupTimer);
		startupTimer = undefined;
	};
	input.once("end", abortFromInput);
	input.once("close", abortFromInput);
	if (startupTimeoutMs > 0) {
		startupTimer = setTimeout(() => {
			startupExpired = true;
			input.destroy();
			try {
				stderr.write(`[lsp-daemon] no MCP request received within ${startupTimeoutMs}ms; exiting\n`);
			} catch (error) {
				if (stderr !== process.stderr) {
					process.stderr.write(
						`[lsp-daemon] startup diagnostic failed: ${error instanceof Error ? error.message : String(error)}\n`,
					);
				}
			}
		}, startupTimeoutMs);
	}

	try {
		const paths = options.paths ?? daemonPaths();
		const env = options.env ?? process.env;
		const cwd = options.cwd ?? inferOpenCodeProjectCwd(env["LSP_TOOLS_MCP_PROJECT_CONFIG"]);
		const contextEnv = cwd === undefined ? env : canonicalizeContextEnv(env);
		const contextInput = {
			env: contextEnv,
			...(cwd === undefined ? {} : { cwd }),
			...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
		};
		const context = options.context ?? createStandaloneMcpRequestContext(contextInput);
		const callOptions: CallToolOptions = {
			paths,
			context,
			...(options.ensure ? { ensure: options.ensure } : {}),
			signal: lifecycleController.signal,
		};
		await runJsonRpcStdioServer({
			input,
			output,
			idleTimeoutMs: 0,
			handler: (request, requestOptions) => {
				clearStartupWatchdog();
				return runWithRequestContext(context, () => handleProxyRequest(request, requestOptions));
			},
			handlerOptions: callOptions,
			onHandlerError: (error: unknown) => {
				stderr.write(`[lsp-daemon] proxy error: ${error instanceof Error ? error.message : String(error)}\n`);
			},
		});
	} catch (error) {
		if (!startupExpired || !isPrematureCloseError(error)) throw error;
	} finally {
		if (startupTimer !== undefined) clearTimeout(startupTimer);
		input.removeListener("end", abortFromInput);
		input.removeListener("close", abortFromInput);
	}
}

function isPrematureCloseError(error: unknown): boolean {
	return error instanceof Error && Reflect.get(error, "code") === "ERR_STREAM_PREMATURE_CLOSE";
}

async function handleProxyRequest(parsed: unknown, callOptions: CallToolOptions): Promise<JsonRpcResponse | undefined> {
	const toolCall = asToolCall(parsed);
	if (!toolCall) return handleLspMcpRequest(parsed);

	const result = await callToolViaDaemon(toolCall.name, toolCall.args, callOptions);
	return successResponse(toolCall.id, {
		content: result.content,
		isError: result.isError ?? false,
		details: result.details,
	});
}

function asToolCall(parsed: unknown): ToolCall | null {
	if (!isPlainRecord(parsed) || parsed["method"] !== "tools/call") return null;
	const params = parsed["params"];
	if (!isPlainRecord(params) || typeof params["name"] !== "string") return null;
	const args = params["arguments"];
	return { id: jsonRpcId(parsed["id"]), name: params["name"], args: isPlainRecord(args) ? args : {} };
}

function inferOpenCodeProjectCwd(projectConfigEnv: string | undefined): string | undefined {
	if (!projectConfigEnv) return undefined;
	for (const entry of projectConfigEnv.split(delimiter)) {
		const projectRoot = projectRootFromOpenCodeConfigPath(entry);
		if (projectRoot) return projectRoot;
	}
	return undefined;
}

function canonicalizeContextEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
	return {
		...env,
		LSP_TOOLS_MCP_PROJECT_CONFIG: canonicalizePathList(env["LSP_TOOLS_MCP_PROJECT_CONFIG"]),
		LSP_TOOLS_MCP_USER_CONFIG: canonicalizePath(env["LSP_TOOLS_MCP_USER_CONFIG"]),
		LSP_TOOLS_MCP_INSTALL_DECISIONS: canonicalizePath(env["LSP_TOOLS_MCP_INSTALL_DECISIONS"]),
	};
}

function canonicalizePathList(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	return value
		.split(delimiter)
		.map((entry) => canonicalizePath(entry) ?? entry)
		.join(delimiter);
}

function canonicalizePath(value: string | undefined): string | undefined {
	if (value === undefined || !isAbsolute(value) || !existsSync(value)) return value;
	return realpathSync(value);
}

function projectRootFromOpenCodeConfigPath(path: string): string | undefined {
	if (basename(path) !== "lsp.json" && basename(path) !== "lsp-client.json") return undefined;
	const configDir = dirname(path);
	const configDirName = basename(configDir);
	if (configDirName !== ".opencode" && configDirName !== ".omo") return undefined;
	return dirname(configDir);
}
