import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { callToolViaDaemon, currentRequestContext } from "../src/daemon-client.js";
import { authEnvelope } from "../src/ipc-protocol.js";
import type { DaemonPaths } from "../src/paths.js";
import { createLineDecoder, encodeJsonLine } from "../src/socket-jsonrpc.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

const tempDirectories: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempPaths(): DaemonPaths {
	const dir = mkdtempSync(join(tmpdir(), "lsp-daemon-retry-"));
	tempDirectories.push(dir);
	const paths = daemonTestPaths(dir);
	mkdirSync(paths.dir, { recursive: true });
	writeFileSync(paths.auth, "retry-test-token\n", { mode: 0o600 });
	return paths;
}

function defaultContext() {
	return currentRequestContext();
}

function jsonRpcMethod(message: unknown): string | undefined {
	if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
	const method = Reflect.get(message, "method");
	return typeof method === "string" ? method : undefined;
}

function jsonRpcId(message: unknown): string | number | null | undefined {
	if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
	const id = Reflect.get(message, "id");
	return typeof id === "string" || typeof id === "number" || id === null ? id : undefined;
}

function cancelTargetId(message: unknown): string | number | undefined {
	if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
	const params = Reflect.get(message, "params");
	if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
	const id = Reflect.get(params, "id");
	return typeof id === "string" || typeof id === "number" ? id : undefined;
}

function createMessageRecorder() {
	const messages: unknown[] = [];
	const waiters: Array<() => void> = [];
	return {
		messages,
		push(message: unknown): void {
			messages.push(message);
			for (const wake of waiters.splice(0)) wake();
		},
		waitForCount(count: number): Promise<void> {
			if (messages.length >= count) return Promise.resolve();
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					reject(new Error(`waited for ${count} daemon messages, observed ${messages.length}`));
				}, 1_000);
				const wake = (): void => {
					if (messages.length < count) {
						waiters.push(wake);
						return;
					}
					clearTimeout(timer);
					resolve();
				};
				waiters.push(wake);
			});
		},
	};
}

function recordMessages(socket: Socket, recorder: ReturnType<typeof createMessageRecorder>): void {
	const decoder = createLineDecoder((message) => recorder.push(message));
	socket.on("data", (chunk: Buffer) => decoder.push(chunk));
}

describe("daemon-client retry discipline", () => {
	it("#given a server that never answers in time #when the call times out #then the request is executed exactly once", async () => {
		const paths = tempPaths();
		let requestCount = 0;
		const server = createServer((socket) => {
			const decoder = createLineDecoder(() => {
				requestCount += 1;
			});
			socket.on("data", (chunk) => decoder.push(chunk));
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(paths.socket, resolve));

		const result = await callToolViaDaemon(
			"status",
			{},
			{
				paths,
				ensure: async () => {},
				requestTimeoutMs: 100,
				context: defaultContext(),
			},
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("daemon request timed out");
		expect(result.content[0]?.text).not.toContain("unreachable");
		expect(requestCount).toBe(1);
	});

	it("#given a daemon request timeout #when request bytes were written #then an authenticated cancel is sent for the proxy id before close", async () => {
		const paths = tempPaths();
		const recorder = createMessageRecorder();
		const server = createServer((socket) => {
			recordMessages(socket, recorder);
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(paths.socket, resolve));

		const result = await callToolViaDaemon(
			"status",
			{},
			{ paths, ensure: async () => {}, requestTimeoutMs: 50, context: defaultContext() },
		);
		await recorder.waitForCount(2);

		const request = recorder.messages.find((message) => jsonRpcMethod(message) === "tools/call");
		const cancel = recorder.messages.find((message) => jsonRpcMethod(message) === "$/cancelRequest");
		expect(result.isError).toBe(true);
		expect(jsonRpcId(request)).not.toBe(1);
		expect(cancelTargetId(cancel)).toBe(jsonRpcId(request));
		expect(extractToken(cancel)).toBe("retry-test-token");
	});

	it("#given a caller abort #when request bytes were written #then the daemon client sends authenticated cancellation for the same proxy id", async () => {
		const paths = tempPaths();
		const controller = new AbortController();
		const recorder = createMessageRecorder();
		const server = createServer((socket) => {
			const decoder = createLineDecoder((message) => {
				recorder.push(message);
				if (jsonRpcMethod(message) === "tools/call") controller.abort();
			});
			socket.on("data", (chunk) => decoder.push(chunk));
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(paths.socket, resolve));

		const result = await callToolViaDaemon(
			"status",
			{},
			{ paths, ensure: async () => {}, requestTimeoutMs: 100, signal: controller.signal, context: defaultContext() },
		);
		await recorder.waitForCount(2);

		const request = recorder.messages.find((message) => jsonRpcMethod(message) === "tools/call");
		const cancel = recorder.messages.find((message) => jsonRpcMethod(message) === "$/cancelRequest");
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("cancelled");
		expect(result.content[0]?.text).not.toContain("unreachable");
		expect(cancelTargetId(cancel)).toBe(jsonRpcId(request));
		expect(extractToken(cancel)).toBe("retry-test-token");
	});

	it("#given the socket appears only after the first connect failure #when retrying #then the second attempt succeeds with one delivered request", async () => {
		const paths = tempPaths();
		let requestCount = 0;
		let ensureCallCount = 0;

		const server = createServer((socket) => {
			const decoder = createLineDecoder((message) => {
				requestCount += 1;
				const id = jsonRpcId(message);
				socket.write(encodeJsonLine({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "ok" }] } }));
			});
			socket.on("data", (chunk) => decoder.push(chunk));
		});
		servers.push(server);

		const ensure = async (): Promise<void> => {
			ensureCallCount += 1;
			if (ensureCallCount === 1) return;
			await new Promise<void>((resolve) => server.listen(paths.socket, resolve));
		};

		const result = await callToolViaDaemon(
			"status",
			{},
			{
				paths,
				ensure,
				requestTimeoutMs: 2000,
				context: defaultContext(),
			},
		);

		expect(result.content[0]?.text).toBe("ok");
		expect(requestCount).toBe(1);
	});

	it("#given the server closes the connection after reading the request #then no retry happens", async () => {
		const paths = tempPaths();
		let requestCount = 0;
		const server = createServer((socket) => {
			const decoder = createLineDecoder(() => {
				requestCount += 1;
				socket.destroy();
			});
			socket.on("data", (chunk) => decoder.push(chunk));
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(paths.socket, resolve));

		const result = await callToolViaDaemon(
			"status",
			{},
			{
				paths,
				ensure: async () => {},
				requestTimeoutMs: 2000,
				context: defaultContext(),
			},
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("daemon connection closed");
		expect(requestCount).toBe(1);
	});

	it("#given a mutating rename cannot connect #when no request bytes were written #then it is not retried", async () => {
		const paths = tempPaths();
		let ensureCallCount = 0;
		const result = await callToolViaDaemon(
			"rename",
			{ filePath: "a.ts", line: 1, character: 0, newName: "b" },
			{
				paths,
				ensure: async () => {
					ensureCallCount += 1;
				},
				requestTimeoutMs: 50,
				context: defaultContext(),
			},
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("daemon");
		expect(ensureCallCount).toBe(1);
	});

	it.each([
		{ label: "null", result: null },
		{ label: "array", result: [] },
		{ label: "non-array content", result: { content: "not-an-array" } },
	])("#given an invalid daemon result $label #when the response is received #then it is rejected without retry", async ({
		result: invalidResult,
	}) => {
		const paths = tempPaths();
		let requestCount = 0;
		const server = createServer((socket) => {
			const decoder = createLineDecoder((message) => {
				requestCount += 1;
				socket.write(encodeJsonLine({ jsonrpc: "2.0", id: jsonRpcId(message), result: invalidResult }));
			});
			socket.on("data", (chunk) => decoder.push(chunk));
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(paths.socket, resolve));

		const result = await callToolViaDaemon(
			"status",
			{},
			{
				paths,
				ensure: async () => {},
				requestTimeoutMs: 2000,
				context: defaultContext(),
			},
		);

		expect(result.content[0]?.text).toContain("invalid daemon response");
		expect(requestCount).toBe(1);
	});

	it("given auth is rotated before Core dispatch when the client is rejected then it rereads auth exactly once", async () => {
		const paths = tempPaths();
		const freshToken = "fresh-retry-test-token";
		let requestCount = 0;
		const seenTokens: string[] = [];
		const server = createServer((socket) => {
			const decoder = createLineDecoder((message) => {
				requestCount += 1;
				const token = extractToken(message);
				if (token) seenTokens.push(token);
				if (requestCount === 1) {
					writeFileSync(paths.auth, `${freshToken}\n`, { mode: 0o600 });
					socket.write(
						encodeJsonLine({
							jsonrpc: "2.0",
							id: jsonRpcId(message),
							error: {
								code: -32001,
								message: "daemon authentication failed",
								data: { code: "daemon_authentication_failed" },
							},
						}),
					);
					return;
				}
				socket.write(
					encodeJsonLine({
						jsonrpc: "2.0",
						id: jsonRpcId(message),
						result: { content: [{ type: "text", text: "ok" }] },
					}),
				);
			});
			socket.on("data", (chunk) => decoder.push(chunk));
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(paths.socket, resolve));

		const result = await callToolViaDaemon(
			"status",
			{},
			{ paths, ensure: async () => {}, requestTimeoutMs: 2000, context: defaultContext() },
		);

		expect(result.content[0]?.text).toBe("ok");
		expect(requestCount).toBe(2);
		expect(seenTokens).toEqual(["retry-test-token", freshToken]);
		expect(readFileSync(paths.auth, "utf8").trim()).toBe(freshToken);
	});
});

function extractToken(message: unknown): string | null {
	if (!message || typeof message !== "object" || Array.isArray(message)) return null;
	const params = Reflect.get(message, "params");
	if (!params || typeof params !== "object" || Array.isArray(params)) return null;
	const omo = Reflect.get(params, "_omo");
	if (!omo || typeof omo !== "object" || Array.isArray(omo)) return null;
	const expected = authEnvelope("probe");
	const token = Reflect.get(omo, "token");
	return Reflect.get(omo, "protocolVersion") === expected.protocolVersion && typeof token === "string" ? token : null;
}
