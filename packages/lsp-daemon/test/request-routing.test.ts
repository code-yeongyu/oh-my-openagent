import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleLspMcpRequest, type JsonRpcResponse } from "@oh-my-opencode/lsp-core/mcp";

import { authEnvelope } from "../src/ipc-protocol.js";
import { extractRequestContext, handleDaemonMessage } from "../src/request-routing.js";

vi.mock("@oh-my-opencode/lsp-core/mcp", () => ({
	handleLspMcpRequest: vi.fn(async () => ({
		jsonrpc: "2.0",
		id: 1,
		result: { content: [{ type: "text", text: "core dispatched" }] },
	})),
}));

const tempDirectories: string[] = [];
const dispatchMock = vi.mocked(handleLspMcpRequest);

afterEach(() => {
	for (const dir of tempDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
	dispatchMock.mockClear();
});

function tempProject(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "lsp-routing-context-")));
	tempDirectories.push(root);
	return root;
}

function validContext(root: string) {
	return {
		cwd: root,
		projectConfigPaths: [join(root, "lsp.json")],
		userConfigPath: join(root, "user-lsp.json"),
		installDecisionsPath: join(root, "install-decisions.json"),
		capabilities: { installDecisionTool: true },
	};
}

function authenticatedToolCall(id: number, token: string, args: Record<string, unknown>) {
	return {
		jsonrpc: "2.0",
		id,
		method: "tools/call",
		params: { _omo: authEnvelope(token), name: "status", arguments: args },
	};
}

function responseCode(response: unknown): string | undefined {
	if (!response || typeof response !== "object" || !("error" in response)) return undefined;
	const error = Reflect.get(response, "error");
	if (!error || typeof error !== "object" || !("data" in error)) return undefined;
	const data = Reflect.get(error, "data");
	if (!data || typeof data !== "object" || !("code" in data)) return undefined;
	const code = Reflect.get(data, "code");
	return typeof code === "string" ? code : undefined;
}

function deferredResponse(): { readonly promise: Promise<JsonRpcResponse | undefined>; readonly resolve: (value: JsonRpcResponse) => void } {
	let resolvePromise: (value: JsonRpcResponse) => void = () => {};
	const promise = new Promise<JsonRpcResponse | undefined>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

describe("extractRequestContext", () => {
	it("#given a non tools/call message #when extract #then no context and input unchanged", () => {
		const raw = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
		const routed = extractRequestContext(raw);
		expect(routed.context).toBeUndefined();
		expect(routed.input).toBe(raw);
	});

	it("#given tools/call with _context #when extract #then context parsed and stripped from arguments", () => {
		const cwd = process.cwd();
		const raw = {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: {
				name: "diagnostics",
				arguments: {
					filePath: "/a.ts",
					_context: {
						cwd,
						projectConfigPaths: [join(cwd, ".codex", "lsp-client.json")],
						userConfigPath: join(homedir(), ".codex", "lsp-client.json"),
						installDecisionsPath: join(homedir(), ".codex", "lsp-install-decisions.json"),
						capabilities: { installDecisionTool: true },
					},
				},
			},
		};
		const routed = extractRequestContext(raw);
		expect(routed.context).toEqual({
			cwd,
			projectConfigPaths: [join(cwd, ".codex", "lsp-client.json")],
			userConfigPath: join(homedir(), ".codex", "lsp-client.json"),
			installDecisionsPath: join(homedir(), ".codex", "lsp-install-decisions.json"),
			capabilities: { installDecisionTool: true },
		});
		const args = (routed.input as { params: { arguments: Record<string, unknown> } }).params.arguments;
		expect(args).toEqual({ filePath: "/a.ts" });
		expect("_context" in args).toBe(false);
	});

	it("#given tools/call without _context #when extract #then rejects before lookup", () => {
		const raw = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "status", arguments: {} } };
		expect(() => extractRequestContext(raw)).toThrow(/_context/);
	});

	it("#given tools/call with empty _context #when extract #then rejects before lookup", () => {
		const raw = {
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "status", arguments: { _context: {} } },
		};
		expect(() => extractRequestContext(raw)).toThrow();
	});

	it.each([
		{ name: "scalar", context: "not-an-object" },
		{ name: "array", context: [] },
		{ name: "null", context: null },
	])(
		"#given authenticated tools/call with $name _context #when routed #then invalid request returns before Core dispatch",
		async ({ context }) => {
			const token = "secret-token";
			const response = await handleDaemonMessage(authenticatedToolCall(20, token, { _context: context }), {
				token,
				owner: { pid: process.pid, nonce: "test-owner", startedAt: "now", endpoint: { kind: "missing", path: "memory" } },
			});

			expect(responseCode(response)).toBe("invalid_daemon_request");
			expect(dispatchMock).not.toHaveBeenCalled();
		},
	);

	it("#given authenticated tools/call with omitted _context #when routed #then invalid request returns before Core dispatch", async () => {
		const token = "secret-token";
		const response = await handleDaemonMessage(authenticatedToolCall(21, token, {}), {
			token,
			owner: { pid: process.pid, nonce: "test-owner", startedAt: "now", endpoint: { kind: "missing", path: "memory" } },
		});

		expect(responseCode(response)).toBe("invalid_daemon_request");
		expect(dispatchMock).not.toHaveBeenCalled();
	});

	it("#given authenticated cancellation for an active daemon request #when routed #then the matching controller aborts and is deleted on settle", async () => {
		const token = "secret-token";
		const activeRequests = new Map<string, AbortController>();
		const pending = deferredResponse();
		let observedSignal: AbortSignal | undefined;
		dispatchMock.mockImplementationOnce((_input, options?: { readonly signal?: AbortSignal }) => {
			observedSignal = options?.signal;
			return pending.promise;
		});

		const root = tempProject();
		const running = handleDaemonMessage(authenticatedToolCall(30, token, { _context: validContext(root) }), {
			token,
			owner: { pid: process.pid, nonce: "test-owner", startedAt: "now", endpoint: { kind: "missing", path: "memory" } },
			activeRequests,
		});
		expect(activeRequests.size).toBe(1);
		await handleDaemonMessage(
			{
				jsonrpc: "2.0",
				method: "$/cancelRequest",
				params: { _omo: authEnvelope(token), id: 30 },
			},
			{
				token,
				owner: { pid: process.pid, nonce: "test-owner", startedAt: "now", endpoint: { kind: "missing", path: "memory" } },
				activeRequests,
			},
		);

		expect(observedSignal?.aborted).toBe(true);
		pending.resolve({ jsonrpc: "2.0", id: 30, result: { content: [{ type: "text", text: "done" }] } });
		await running;
		expect(activeRequests.size).toBe(0);
	});

	it("#given unauthenticated cancellation #when routed #then an active request is not aborted", async () => {
		const token = "secret-token";
		const activeRequests = new Map<string, AbortController>();
		const controller = new AbortController();
		activeRequests.set("31", controller);

		await handleDaemonMessage(
			{
				jsonrpc: "2.0",
				method: "$/cancelRequest",
				params: { _omo: authEnvelope("wrong-token"), id: 31 },
			},
			{
				token,
				owner: { pid: process.pid, nonce: "test-owner", startedAt: "now", endpoint: { kind: "missing", path: "memory" } },
				activeRequests,
			},
		);

		expect(controller.signal.aborted).toBe(false);
		expect(activeRequests.size).toBe(1);
	});

	it("#given actual symlink project config escaping cwd #when extract #then rejects before Core dispatch", () => {
		const root = tempProject();
		const outside = join(tmpdir(), `lsp-routing-outside-${process.pid}-${Date.now()}.json`);
		writeFileSync(outside, "{}");
		tempDirectories.push(outside);
		const linkedConfig = join(root, "linked-outside.json");
		symlinkSync(outside, linkedConfig);

		expect(() =>
			extractRequestContext(
				authenticatedToolCall(22, "secret-token", { _context: { ...validContext(root), projectConfigPaths: [linkedConfig] } }),
			),
		).toThrow(/Project LSP config path must be inside cwd/);
	});

	it("#given symlinked project config resolving inside cwd #when extract #then canonical project path is accepted", () => {
		const root = tempProject();
		const actualDir = join(root, "actual");
		mkdirSync(actualDir);
		const actualConfig = join(actualDir, "lsp.json");
		writeFileSync(actualConfig, "{}");
		const linkedDir = join(root, "linked");
		symlinkSync(actualDir, linkedDir);

		const routed = extractRequestContext(
			authenticatedToolCall(23, "secret-token", {
				_context: { ...validContext(root), projectConfigPaths: [join(linkedDir, "lsp.json")] },
			}),
		);

		expect(routed.context?.projectConfigPaths).toEqual([actualConfig]);
	});

	it("#given missing project config below symlinked parent inside cwd #when extract #then nearest ancestor is canonicalized", () => {
		const root = tempProject();
		const actualDir = join(root, "actual");
		mkdirSync(actualDir);
		const linkedDir = join(root, "linked");
		symlinkSync(actualDir, linkedDir);

		const routed = extractRequestContext(
			authenticatedToolCall(24, "secret-token", {
				_context: { ...validContext(root), projectConfigPaths: [join(linkedDir, "missing", "lsp.json")] },
			}),
		);

		expect(routed.context?.projectConfigPaths).toEqual([join(actualDir, "missing", "lsp.json")]);
	});
});
