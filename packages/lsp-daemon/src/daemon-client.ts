import { connect } from "node:net";

import { runWithRequestContext } from "@code-yeongyu/lsp-tools-mcp/dist/request-context.js";
import { executeLspTool, type ToolExecutionResult } from "@code-yeongyu/lsp-tools-mcp/dist/tools.js";

import { ensureDaemonRunning } from "./ensure-daemon.js";
import { type DaemonPaths, daemonPaths } from "./paths.js";
import { CONTEXT_KEY } from "./request-routing.js";
import { createLineDecoder, encodeJsonLine } from "./socket-jsonrpc.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_ID = 1;

export interface DaemonToolContext {
	cwd?: string;
	env?: Record<string, string>;
}

export interface CallToolOptions {
	context?: DaemonToolContext;
	paths?: DaemonPaths;
	requestTimeoutMs?: number;
	ensure?: (paths: DaemonPaths) => Promise<void>;
}

export async function callToolViaDaemon(
	name: string,
	args: Record<string, unknown>,
	options: CallToolOptions = {},
): Promise<ToolExecutionResult> {
	const paths = options.paths ?? daemonPaths();
	const ensure = options.ensure ?? ensureDaemonRunning;
	const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const requestArgs = withContext(args, options.context);

	let lastError: unknown;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			await ensure(paths);
			return await sendToolCall(paths.socket, name, requestArgs, timeoutMs);
		} catch (error) {
			lastError = error;
		}
	}

	logClientFallback(lastError);
	try {
		return await runLocally(name, args, options.context);
	} catch (error) {
		return { content: [{ type: "text", text: errorText(error) }], isError: true };
	}
}

export function callDiagnosticsViaDaemon(
	filePath: string,
	options: CallToolOptions = {},
): Promise<ToolExecutionResult> {
	return callToolViaDaemon("diagnostics", { filePath, severity: "error" }, options);
}

export function currentRequestContext(env: NodeJS.ProcessEnv = process.env): DaemonToolContext {
	const forwarded: Record<string, string> = {};
	const project = env["LSP_TOOLS_MCP_PROJECT_CONFIG"];
	if (project !== undefined) forwarded["LSP_TOOLS_MCP_PROJECT_CONFIG"] = project;
	const user = env["LSP_TOOLS_MCP_USER_CONFIG"];
	if (user !== undefined) forwarded["LSP_TOOLS_MCP_USER_CONFIG"] = user;
	return { cwd: process.cwd(), env: forwarded };
}

function withContext(args: Record<string, unknown>, context: DaemonToolContext | undefined): Record<string, unknown> {
	if (!context || (context.cwd === undefined && context.env === undefined)) return args;
	return { ...args, [CONTEXT_KEY]: context };
}

function runLocally(
	name: string,
	args: Record<string, unknown>,
	context: DaemonToolContext | undefined,
): Promise<ToolExecutionResult> {
	if (context) return runWithRequestContext(context, () => executeLspTool(name, args));
	return executeLspTool(name, args);
}

function sendToolCall(
	socketPath: string,
	name: string,
	args: Record<string, unknown>,
	timeoutMs: number,
): Promise<ToolExecutionResult> {
	return new Promise((resolve, reject) => {
		const socket = connect(socketPath);
		let settled = false;
		const finish = (run: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			run();
		};
		const timer = setTimeout(() => finish(() => reject(new Error("daemon request timed out"))), timeoutMs);
		timer.unref();
		const decoder = createLineDecoder((message) => {
			const result = toToolResult(message);
			if (result) finish(() => resolve(result));
			else finish(() => reject(new Error("invalid daemon response")));
		});
		socket.once("connect", () => {
			socket.write(
				encodeJsonLine({ jsonrpc: "2.0", id: REQUEST_ID, method: "tools/call", params: { name, arguments: args } }),
			);
		});
		socket.on("data", (chunk) => decoder.push(chunk));
		socket.once("error", (error) => finish(() => reject(error)));
		socket.once("close", () => finish(() => reject(new Error("daemon connection closed"))));
	});
}

function toToolResult(message: unknown): ToolExecutionResult | null {
	if (!isRecord(message) || message["id"] !== REQUEST_ID) return null;
	const result = message["result"];
	if (!isRecord(result) || !Array.isArray(result["content"])) return null;
	return {
		content: result["content"] as ToolExecutionResult["content"],
		isError: result["isError"] === true,
		details: result["details"],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function logClientFallback(error: unknown): void {
	process.stderr.write(`[lsp-daemon] falling back to in-process execution: ${errorText(error)}\n`);
}
