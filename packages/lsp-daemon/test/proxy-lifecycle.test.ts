import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import type { DaemonPaths } from "../src/paths.js";
import { runMcpStdioProxy } from "../src/proxy.js";
import { createLineDecoder } from "../src/socket-jsonrpc.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

const tempDirectories: string[] = [];
const servers: Server[] = [];
const sockets = new Set<Socket>();

afterEach(async () => {
	for (const socket of sockets) socket.destroy();
	for (const server of servers.splice(0)) {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("mcp stdio proxy lifecycle", () => {
	it("#given an in-flight daemon request #when parent input closes and the lifecycle aborts #then the proxy cancels that request and closes its socket", async () => {
		const paths = tempPaths();
		const requestAccepted = deferred();
		const cancellationObserved = deferred();
		const connectionClosed = deferred();
		let daemonRequestId: string | number | null | undefined;
		let cancelledRequestId: string | number | undefined;
		const daemon = createServer((socket) => {
			sockets.add(socket);
			const decoder = createLineDecoder((message) => {
				const method = jsonRpcMethod(message);
				if (method === "tools/call") {
					daemonRequestId = jsonRpcId(message);
					requestAccepted.resolve();
					return;
				}
				if (method === "$/cancelRequest") {
					cancelledRequestId = cancelTargetId(message);
					cancellationObserved.resolve();
				}
			});
			socket.on("data", (chunk) => decoder.push(chunk));
			socket.on("error", () => {});
			socket.once("close", () => {
				sockets.delete(socket);
				connectionClosed.resolve();
			});
		});
		servers.push(daemon);
		await listen(daemon, paths.socket);

		const input = new PassThrough();
		const controller = new AbortController();
		const proxyOptions = {
			input,
			output: discardOutput(),
			paths,
			ensure: noSpawn,
			signal: controller.signal,
		};
		const proxy = runMcpStdioProxy(proxyOptions);
		input.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "status", arguments: {} } })}\n`,
		);
		await bounded(requestAccepted.promise, "fake daemon did not accept the proxy request");

		input.end();
		controller.abort();

		await bounded(
			Promise.all([proxy, cancellationObserved.promise, connectionClosed.promise]),
			`fake daemon accepted tools/call id=${String(daemonRequestId)}; proxy did not settle it after lifecycle cancellation`,
		);
		expect(cancelledRequestId).toBe(daemonRequestId);
		expect(sockets.size).toBe(0);
	});
});

function tempPaths(): DaemonPaths {
	const directory = mkdtempSync(join(tmpdir(), "lsp-daemon-proxy-lifecycle-"));
	tempDirectories.push(directory);
	const paths = daemonTestPaths(directory);
	mkdirSync(paths.dir, { recursive: true });
	if (process.platform !== "win32") {
		const socketDirectory = dirname(paths.socket);
		mkdirSync(socketDirectory, { recursive: true });
		const socketDirectoryFromRoot = relative(directory, socketDirectory);
		const socketDirectoryIsExternal =
			isAbsolute(socketDirectoryFromRoot) ||
			socketDirectoryFromRoot === ".." ||
			socketDirectoryFromRoot.startsWith(`..${sep}`);
		if (socketDirectoryIsExternal) tempDirectories.push(socketDirectory);
	}
	writeFileSync(paths.auth, "proxy-lifecycle-token\n", { mode: 0o600 });
	return paths;
}

function listen(server: Server, socketPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error): void => reject(error);
		server.once("error", onError);
		server.listen(socketPath, () => {
			server.removeListener("error", onError);
			resolve();
		});
	});
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: () => resolvePromise?.() };
}

async function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(message)), 1_000);
				timer.unref();
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

function discardOutput(): Writable {
	return new Writable({
		write(_chunk, _encoding, callback): void {
			callback();
		},
	});
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

const noSpawn = (): Promise<void> => Promise.resolve();
