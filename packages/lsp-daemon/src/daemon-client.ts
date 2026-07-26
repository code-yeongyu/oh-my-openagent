import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { type LspRequestContext, parseLspRequestContext } from "@oh-my-opencode/lsp-core/request-context";
import type { ToolExecutionResult } from "@oh-my-opencode/lsp-core/tools";
import { isPlainRecord } from "@oh-my-opencode/mcp-stdio-core/record";

import { daemonFailureResult } from "./daemon-failure-result.js";
import {
	DaemonAuthenticationRejectedError,
	DaemonRequestCancelledError,
	DaemonRequestError,
	DaemonRequestTimedOutError,
} from "./daemon-request-error.js";
import { ensureDaemonRunning } from "./ensure-daemon.js";
import { authEnvelope, isAuthErrorResponse, readAuthToken } from "./ipc-protocol.js";
import { type DaemonPaths, daemonPaths } from "./paths.js";
import { CONTEXT_KEY } from "./request-routing.js";
import { createLineDecoder, encodeJsonLine } from "./socket-jsonrpc.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
let nextProxyRequestId = 1;

export type DaemonToolContext = LspRequestContext;

export interface CallToolOptions {
	context: DaemonToolContext;
	paths?: DaemonPaths;
	requestTimeoutMs?: number;
	signal?: AbortSignal;
	ensure?: (paths: DaemonPaths, signal?: AbortSignal) => Promise<void>;
}

type EnsureDaemon = NonNullable<CallToolOptions["ensure"]>;

export async function callToolViaDaemon(
	name: string,
	args: Record<string, unknown>,
	options: CallToolOptions,
): Promise<ToolExecutionResult> {
	const context = requireContext(options.context);
	const paths = options.paths ?? daemonPaths();
	const ensure =
		options.ensure ??
		((ensurePaths: DaemonPaths, signal?: AbortSignal) =>
			ensureDaemonRunning(ensurePaths, undefined, signal === undefined ? {} : { signal }));
	const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const requestArgs = withContext(args, context);

	let lastError: unknown;
	let authRefreshUsed = false;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await ensureDaemonAvailable(paths, ensure, options.signal);
			const token = readAuthToken(paths);
			if (!token) throw new DaemonRequestError("daemon auth token missing", false);
			const sendOptions = options.signal === undefined ? { timeoutMs } : { timeoutMs, signal: options.signal };
			return await sendToolCall(paths, token, name, requestArgs, sendOptions);
		} catch (error) {
			lastError = error;
			if (error instanceof DaemonAuthenticationRejectedError && !authRefreshUsed) {
				authRefreshUsed = true;
				continue;
			}
			if (error instanceof DaemonRequestCancelledError) break;
			if (error instanceof DaemonRequestError && (error.requestWritten || !isRetryableTool(name))) break;
		}
	}

	return daemonFailureResult(paths, lastError);
}

export function callDiagnosticsViaDaemon(filePath: string, options: CallToolOptions): Promise<ToolExecutionResult> {
	return callToolViaDaemon("diagnostics", { filePath, severity: "error" }, options);
}

export function currentRequestContext(env: NodeJS.ProcessEnv = process.env): DaemonToolContext {
	const cwd = process.cwd();
	const home = env["HOME"] ?? homedir();
	return parseLspRequestContext({
		cwd,
		projectConfigPaths: [join(cwd, ".codex", "lsp-client.json")],
		userConfigPath: join(home, ".codex", "lsp-client.json"),
		installDecisionsPath: join(home, ".codex", "lsp-install-decisions.json"),
		capabilities: { installDecisionTool: true },
	});
}

function requireContext(context: unknown): DaemonToolContext {
	if (!context) throw new DaemonRequestError("daemon tool context is required", false);
	return parseLspRequestContext(context);
}

function withContext(args: Record<string, unknown>, context: DaemonToolContext): Record<string, unknown> {
	return { ...args, [CONTEXT_KEY]: context };
}

function ensureDaemonAvailable(
	paths: DaemonPaths,
	ensure: EnsureDaemon,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (!signal) return ensure(paths);
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (run: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			run();
		};
		const onAbort = (): void => finish(() => reject(new DaemonRequestCancelledError(false)));
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		Promise.resolve()
			.then(() => ensure(paths, signal))
			.then(
				() => finish(() => resolve()),
				(error: unknown) => finish(() => reject(signal.aborted ? new DaemonRequestCancelledError(false) : error)),
			);
	});
}

function sendToolCall(
	paths: DaemonPaths,
	token: string,
	name: string,
	args: Record<string, unknown>,
	options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<ToolExecutionResult> {
	return new Promise((resolve, reject) => {
		const socket = connect(paths.socket);
		const requestId = allocateProxyRequestId();
		let settled = false;
		let requestWritten = false;
		let cancelAfterWrite = false;
		const cancelPayload = (): string =>
			encodeJsonLine({
				jsonrpc: "2.0",
				method: "$/cancelRequest",
				params: { _omo: authEnvelope(token), id: requestId },
			});
		const finish = (run: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			destroyAfterCancel();
			run();
		};
		const sendCancel = (): void => {
			if (!requestWritten) {
				cancelAfterWrite = true;
				return;
			}
			if (!socket.writable) return;
			socket.write(cancelPayload());
		};
		const destroyAfterCancel = (): void => {
			socket.destroy();
		};
		const onAbort = (): void => {
			sendCancel();
			finish(() => reject(new DaemonRequestCancelledError(requestWritten)));
		};
		const timer = setTimeout(() => {
			sendCancel();
			finish(() => reject(new DaemonRequestTimedOutError(requestWritten, options.timeoutMs)));
		}, options.timeoutMs);
		timer.unref();
		if (options.signal?.aborted) {
			onAbort();
			return;
		}
		options.signal?.addEventListener("abort", onAbort, { once: true });
		const decoder = createLineDecoder((message) => {
			if (isAuthErrorResponse(message)) {
				finish(() => reject(new DaemonAuthenticationRejectedError()));
				return;
			}
			const result = toToolResult(message, requestId);
			if (result) finish(() => resolve(result));
			else finish(() => reject(new DaemonRequestError("invalid daemon response", requestWritten)));
		});
		socket.once("connect", () => {
			const payload = encodeJsonLine({
				jsonrpc: "2.0",
				id: requestId,
				method: "tools/call",
				params: { _omo: authEnvelope(token), name, arguments: args },
			});
			socket.write(payload, () => {
				requestWritten = true;
				if (cancelAfterWrite && socket.writable) socket.write(cancelPayload());
			});
		});
		socket.on("data", (chunk) => decoder.push(chunk));
		socket.once("error", (error) => finish(() => reject(new DaemonRequestError(error.message, requestWritten))));
		socket.once("close", () =>
			finish(() => reject(new DaemonRequestError("daemon connection closed", requestWritten))),
		);
	});
}

function toToolResult(message: unknown, requestId: number): ToolExecutionResult | null {
	if (!isPlainRecord(message) || message["id"] !== requestId) return null;
	const result = message["result"];
	if (!isPlainRecord(result) || !Array.isArray(result["content"])) return null;
	return {
		content: result["content"] as ToolExecutionResult["content"],
		isError: result["isError"] === true,
		details: result["details"],
	};
}

function allocateProxyRequestId(): number {
	const id = nextProxyRequestId;
	nextProxyRequestId += 1;
	if (nextProxyRequestId > Number.MAX_SAFE_INTEGER) nextProxyRequestId = 1;
	return id;
}

function isRetryableTool(name: string): boolean {
	return name !== "rename" && name !== "lsp_rename";
}
