import { PassThrough, Writable } from "node:stream";

import { describe, expect, it } from "bun:test";

import { reportBestEffortCleanupError } from "./cleanup-errors.js";
import { JsonRpcConnection } from "./json-rpc-connection.js";

type JsonMessage = Record<string, unknown>;

function messageId(message: JsonMessage): string | number | null | undefined {
	const id = message["id"];
	return typeof id === "string" || typeof id === "number" || id === null ? id : undefined;
}

function cancelTarget(message: JsonMessage): string | number | undefined {
	const params = message["params"];
	if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
	const id = Reflect.get(params, "id");
	return typeof id === "string" || typeof id === "number" ? id : undefined;
}

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
				messages.push(Object.fromEntries(Object.entries(parsed)));
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

describe("JsonRpcConnection cancellation", () => {
	it("#given an active request #when its signal aborts #then cancel uses the same id and late responses are ignored", async () => {
		const serverToClient = new PassThrough();
		const clientToServer = new PassThrough();
		const recorder = recordJsonRpcMessages(clientToServer);
		const connection = new JsonRpcConnection(serverToClient, clientToServer);
		connection.listen();
		const controller = new AbortController();

		const request = connection.sendRequest("textDocument/diagnostic", { textDocument: { uri: "file:///a.ts" } }, {
			signal: controller.signal,
		});
		await recorder.waitForCount(1);
		const requestId = messageId(recorder.messages[0] ?? {});
		expect(typeof requestId === "string" || typeof requestId === "number").toBe(true);

		controller.abort(new Error("caller cancelled"));
		await recorder.waitForCount(2);
		await expect(request).rejects.toThrow("caller cancelled");
		expect(connection.pendingRequestCount()).toBe(0);
		expect(recorder.messages[1]?.["method"]).toBe("$/cancelRequest");
		expect(cancelTarget(recorder.messages[1] ?? {})).toBe(typeof requestId === "number" || typeof requestId === "string" ? requestId : undefined);

		serverToClient.write(encodeMessage({ jsonrpc: "2.0", id: requestId ?? null, result: { items: [] } }));
		expect(connection.pendingRequestCount()).toBe(0);
	});
});

describe("JsonRpcConnection cleanup", () => {
	it("#given an in-flight server request #when disposed before its handler settles #then no response writes to the child", async () => {
		const reader = new PassThrough();
		const writer = new PassThrough();
		const recorder = recordJsonRpcMessages(writer);
		const connection = new JsonRpcConnection(reader, writer);
		let finishRequest: ((value: null) => void) | undefined;
		const response = new Promise<null>((resolve) => {
			finishRequest = resolve;
		});
		let requestStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			requestStarted = resolve;
		});
		connection.onRequest("workspace/applyEdit", () => {
			requestStarted?.();
			return response;
		});
		const errors: Error[] = [];
		let reportError: (() => void) | undefined;
		const reported = new Promise<void>((resolve) => {
			reportError = resolve;
		});
		connection.onError((error) => {
			errors.push(error);
			reportError?.();
		});
		connection.listen();
		reader.write(encodeMessage({ jsonrpc: "2.0", id: 1, method: "workspace/applyEdit" }));
		await started;
		connection.dispose();
		finishRequest?.(null);
		await reported;
		expect(recorder.messages).toHaveLength(0);
		expect(errors.map((error) => error.message)).toEqual(["JSON-RPC connection is disposed"]);
		reader.destroy();
		writer.destroy();
	});

	it("#given a queued child-stdin write #when disposal precedes an asynchronous EPIPE #then cleanup reports the error until the writer closes", async () => {
		const reader = new PassThrough();
		let failWrite: ((error: Error) => void) | undefined;
		const writer = new Writable({
			write(_chunk, _encoding, callback) {
				failWrite = callback;
			},
		});
		const messages: string[] = [];
		const connection = new JsonRpcConnection(reader, writer);
		connection.onError((error) => {
			reportBestEffortCleanupError("connection error notification", error, (message) => messages.push(message));
		});
		connection.listen();
		const write = connection.sendNotification("exit");
		const rejected = write.catch((error: unknown) => error);
		const closed = new Promise<void>((resolve) => writer.once("close", resolve));
		connection.dispose();

		expect(writer.listenerCount("error")).toBe(1);
		failWrite?.(Object.assign(new Error("EPIPE: broken pipe, write"), { code: "EPIPE" }));
		expect(await rejected).toMatchObject({ code: "EPIPE" });
		await closed;

		expect(messages).toEqual(["[lsp] ignored connection error notification failure during cleanup: EPIPE: broken pipe, write"]);
		expect(writer.listenerCount("error")).toBe(0);
		reader.destroy();
	});
});
