import { handleLspMcpRequest } from "@oh-my-opencode/lsp-core/mcp";
import { parseLspRequestContext, type RequestContext, runWithRequestContext } from "@oh-my-opencode/lsp-core/request-context";
import { isPlainRecord } from "@oh-my-opencode/mcp-stdio-core/record";

import { authenticateMessage, OMO_DAEMON_PROTOCOL_VERSION } from "./ipc-protocol.js";
import type { DaemonOwner } from "./ownership.js";

export const CONTEXT_KEY = "_context";

class InvalidDaemonRequestError extends Error {
	override readonly name = "InvalidDaemonRequestError";
}

export interface RoutedRequest {
	input: unknown;
	context: RequestContext | undefined;
}

export function extractRequestContext(raw: unknown): RoutedRequest {
	if (!isPlainRecord(raw) || raw["method"] !== "tools/call") return { input: raw, context: undefined };
	const params = raw["params"];
	if (!isPlainRecord(params)) throw new InvalidDaemonRequestError("Daemon tools/call params must be an object.");
	const args = params["arguments"];
	if (!isPlainRecord(args)) throw new InvalidDaemonRequestError("Daemon tools/call arguments must be an object.");
	if (!Object.hasOwn(args, CONTEXT_KEY)) {
		throw new InvalidDaemonRequestError("Daemon tools/call arguments must include _context.");
	}
	const context = parseContext(args[CONTEXT_KEY]);

	const cleanedArgs: Record<string, unknown> = { ...args };
	delete cleanedArgs[CONTEXT_KEY];
	const cleaned = { ...raw, params: { ...params, arguments: cleanedArgs } };
	return { input: cleaned, context };
}

export type DaemonRouteState = {
	readonly token: string;
	readonly owner: DaemonOwner;
	readonly activeRequests?: Map<string, AbortController>;
};

export function handleDaemonMessage(raw: unknown, state: DaemonRouteState): Promise<unknown> {
	const authenticated = authenticateMessage(raw, state.token);
	if ("error" in authenticated) return Promise.resolve(authenticated);
	if (authenticated.method === "omo/ping") {
		return Promise.resolve({
			jsonrpc: "2.0",
			id: authenticated.id,
			result: { protocolVersion: OMO_DAEMON_PROTOCOL_VERSION, ...state.owner },
		});
	}
	if (authenticated.method === "$/cancelRequest") {
		const targetId = cancellationTargetId(authenticated.input);
		if (targetId !== undefined) state.activeRequests?.get(String(targetId))?.abort();
		return Promise.resolve(undefined);
	}
	let routed: RoutedRequest;
	try {
		routed = extractRequestContext(authenticated.input);
	} catch (error) {
		const message = error instanceof Error ? error.message : "invalid daemon request";
		return Promise.resolve({
			jsonrpc: "2.0",
			id: authenticated.id,
			error: { code: -32602, message, data: { code: "invalid_daemon_request" } },
		});
	}
	const { input, context } = routed;
	const key = routeRequestKey(authenticated.id);
	if (key === undefined || !state.activeRequests) {
		if (context) return runWithRequestContext(context, () => handleLspMcpRequest(input));
		return handleLspMcpRequest(input);
	}

	const controller = new AbortController();
	state.activeRequests.set(key, controller);
	const options = { signal: controller.signal };
	const run = context
		? runWithRequestContext(context, () => handleLspMcpRequest(input, options))
		: handleLspMcpRequest(input, options);
	return run.finally(() => {
		if (state.activeRequests?.get(key) === controller) state.activeRequests.delete(key);
	});
}

function routeRequestKey(id: string | number | null): string | undefined {
	return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

function cancellationTargetId(input: Record<string, unknown>): string | number | undefined {
	const params = input["params"];
	if (!isPlainRecord(params)) return undefined;
	const id = params["id"];
	return typeof id === "string" || typeof id === "number" ? id : undefined;
}

function parseContext(value: unknown): RequestContext {
	if (!isPlainRecord(value)) throw new InvalidDaemonRequestError("LSP request _context must be an object.");
	return parseLspRequestContext(value);
}
