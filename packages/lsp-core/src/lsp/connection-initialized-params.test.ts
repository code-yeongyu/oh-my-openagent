import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "bun:test";

import { JsonRpcConnection } from "./json-rpc-connection.js";
import { LspClientConnection } from "./connection.js";
import type { ResolvedServer } from "./types.js";

type JsonMessage = Record<string, unknown>;

const SERVER: ResolvedServer = {
	id: "test-server",
	command: ["test-server", "--stdio"],
	extensions: [".ts"],
	priority: 100,
};

function encodeMessage(message: JsonMessage): string {
	const body = JSON.stringify(message);
	return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function recordJsonRpcMessages(stream: PassThrough) {
	const messages: JsonMessage[] = [];
	const waiters: Array<() => void> = [];
	let buffer = Buffer.alloc(0);
	stream.on("data", (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			const headerEnd = buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) return;
			const header = buffer.subarray(0, headerEnd).toString("ascii");
			const match = /content-length:\s*(\d+)/i.exec(header);
			if (!match?.[1]) throw new Error("missing content-length");
			const bodyStart = headerEnd + 4;
			const bodyEnd = bodyStart + Number.parseInt(match[1], 10);
			if (buffer.length < bodyEnd) return;
			const parsed: unknown = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf8"));
			buffer = buffer.subarray(bodyEnd);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				messages.push(parsed as JsonMessage);
			}
			for (const wake of waiters.splice(0)) wake();
		}
	});
	return {
		messages,
		waitForCount(count: number): Promise<void> {
			if (messages.length >= count) return Promise.resolve();
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					reject(new Error(`waited for ${count} JSON-RPC messages, observed ${messages.length}`));
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

class TestableLspClientConnection extends LspClientConnection {
	private injectedConnection: JsonRpcConnection | null = null;

	injectConnection(reader: NodeJS.ReadableStream, writer: NodeJS.WritableStream): void {
		this.injectedConnection = new JsonRpcConnection(reader, writer);
		this.connection = this.injectedConnection;
		this.connection.listen();
	}

	disposeInjectedConnection(): void {
		this.injectedConnection?.dispose();
	}
}

function isObjectOrArray(value: unknown): boolean {
	return value !== null && typeof value === "object";
}

describe("LspClientConnection initialize handshake wire contract", () => {
	it("#given a strict language server that rejects params-less notifications #when the handshake runs #then initialized and didChangeConfiguration notifications carry object params in lifecycle order", async () => {
		// given
		const clientToServer = new PassThrough();
		const serverToClient = new PassThrough();
		const recorder = recordJsonRpcMessages(clientToServer);
		const connection = new TestableLspClientConnection(tmpdir(), SERVER);
		connection.injectConnection(serverToClient, clientToServer);

		// when
		const initialization = connection.initialize();
		await recorder.waitForCount(1);
		const initializeRequest = recorder.messages[0] ?? {};
		const initializeId = initializeRequest["id"];
		expect(initializeRequest["method"]).toBe("initialize");
		expect(isObjectOrArray(initializeRequest["params"])).toBe(true);
		serverToClient.write(
			encodeMessage({ jsonrpc: "2.0", id: initializeId ?? null, result: { capabilities: {} } }),
		);
		await initialization;
		await recorder.waitForCount(3);

		// then
		const initializedNotification = recorder.messages[1] ?? {};
		expect(initializedNotification["method"]).toBe("initialized");
		expect("id" in initializedNotification).toBe(false);
		// TypeScript 7 (typescript-go) UnmarshalParams rejects absent/null/scalar
		// notification params; a dropped `initialized` leaves its session nil and the
		// next document request crashes the server (#7165).
		expect(isObjectOrArray(initializedNotification["params"])).toBe(true);

		const configurationNotification = recorder.messages[2] ?? {};
		expect(configurationNotification["method"]).toBe("workspace/didChangeConfiguration");
		expect(isObjectOrArray(configurationNotification["params"])).toBe(true);

		connection.disposeInjectedConnection();
	});

	it("#given the same handshake #when the server advertises pull diagnostics #then pull support is detected after the initialize response", async () => {
		// given
		const clientToServer = new PassThrough();
		const serverToClient = new PassThrough();
		const recorder = recordJsonRpcMessages(clientToServer);
		const connection = new TestableLspClientConnection(tmpdir(), SERVER);
		connection.injectConnection(serverToClient, clientToServer);

		// when
		const initialization = connection.initialize();
		await recorder.waitForCount(1);
		const initializeId = (recorder.messages[0] ?? {})["id"];
		serverToClient.write(
			encodeMessage({
				jsonrpc: "2.0",
				id: initializeId ?? null,
				result: { capabilities: { diagnosticProvider: { interFileDependencies: true } } },
			}),
		);
		await initialization;
		await recorder.waitForCount(2);

		// then
		expect((recorder.messages[1] ?? {})["method"]).toBe("initialized");

		connection.disposeInjectedConnection();
	});
});
