import { connect } from "node:net";

import type { ToolExecutionResult } from "@oh-my-opencode/lsp-core/tools";

import { ensureDaemonRunning } from "./ensure-daemon.js";
import { type DaemonPaths, daemonPaths } from "./paths.js";
import { CONTEXT_KEY } from "./request-routing.js";
import { createLineDecoder, encodeJsonLine } from "./socket-jsonrpc.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_ID = 1;

export class DaemonRequestError extends Error {
	readonly requestWritten: boolean;
	constructor(message: string, requestWritten: boolean) {
		super(message);
		this.name = "DaemonRequestError";
		this.requestWritten = requestWritten;
	}
}

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
			if (error instanceof DaemonRequestError && error.requestWritten) break;
		}
	}

	return daemonUnreachableResult(paths, lastError);
}

export function callDiagnosticsViaDaemon(
	filePath: string,
	options: CallToolOptions = {},
): Promise<ToolExecutionResult> {
	return callToolViaDaemon("diagnostics", { filePath, severity: "error" }, options);
}

const FORWARDED_ENV_KEYS = [
	"LSP_TOOLS_MCP_PROJECT_CONFIG",
	"LSP_TOOLS_MCP_USER_CONFIG",
	"LSP_TOOLS_MCP_INSTALL_DECISIONS",
] as const;

export function currentRequestContext(env: NodeJS.ProcessEnv = process.env): DaemonToolContext {
	const forwarded: Record<string, string> = {};
	for (const key of FORWARDED_ENV_KEYS) {
		const value = env[key];
		if (value !== undefined) forwarded[key] = value;
	}
	return { cwd: process.cwd(), env: forwarded };
}

function withContext(args: Record<string, unknown>, context: DaemonToolContext | undefined): Record<string, unknown> {
	if (!context || (context.cwd === undefined && context.env === undefined)) return args;
	return { ...args, [CONTEXT_KEY]: context };
}

function daemonUnreachableResult(paths: DaemonPaths, error: unknown): ToolExecutionResult {
	const text = [
		`LSP daemon unreachable: ${errorText(error)}.`,
		"The MCP server is a thin proxy and never runs language servers in-process.",
		`Socket: ${paths.socket}`,
		`Logs: ${paths.log}`,
		"The daemon is auto-started on demand and will be retried on the next request.",
	].join("\n");
	return { content: [{ type: "text", text }], isError: true };
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
		let requestWritten = false;
		const finish = (run: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			run();
		};
		const timer = setTimeout(
			() => finish(() => reject(new DaemonRequestError("daemon request timed out", requestWritten))),
			timeoutMs,
		);
		timer.unref();
		const decoder = createLineDecoder((message) => {
			const result = toToolResult(message);
			if (result) finish(() => resolve(result));
			else finish(() => reject(new DaemonRequestError("invalid daemon response", requestWritten)));
		});
		socket.once("connect", () => {
			requestWritten = true;
			socket.write(
				encodeJsonLine({ jsonrpc: "2.0", id: REQUEST_ID, method: "tools/call", params: { name, arguments: args } }),
			);
		});
		socket.on("data", (chunk) => decoder.push(chunk));
		socket.once("error", (error) => finish(() => reject(new DaemonRequestError(error.message, requestWritten))));
		socket.once("close", () =>
			finish(() => reject(new DaemonRequestError("daemon connection closed", requestWritten))),
		);
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
