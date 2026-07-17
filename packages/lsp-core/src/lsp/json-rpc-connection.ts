type JsonRpcId = number | string | null;

interface PendingRequest {
	resolve(result: unknown): void;
	reject(error: Error): void;
	cleanup(): void;
}

type NotificationHandler = (params: unknown) => void;
type RequestHandler = (params: unknown) => Promise<unknown> | unknown;

export interface JsonRpcRequestOptions {
	readonly signal?: AbortSignal;
}

const HEADER_SEPARATOR = "\r\n\r\n";
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export class JsonRpcConnection {
	private readonly pendingRequests = new Map<string, PendingRequest>();
	private readonly notificationHandlers = new Map<string, NotificationHandler>();
	private readonly requestHandlers = new Map<string, RequestHandler>();
	private readonly closeHandlers: Array<() => void> = [];
	private readonly errorHandlers: Array<(error: Error) => void> = [];
	private inputBuffer = Buffer.alloc(0);
	private nextRequestId = 1;
	private listening = false;
	private disposed = false;

	constructor(
		private readonly reader: NodeJS.ReadableStream,
		private readonly writer: NodeJS.WritableStream,
	) {}

	listen(): void {
		if (this.listening) return;
		this.listening = true;
		this.reader.on("data", this.handleData);
		this.reader.on("close", this.handleClose);
		this.reader.on("end", this.handleClose);
		this.reader.on("error", this.handleStreamError);
		this.writer.on("error", this.handleStreamError);
	}

	onNotification(method: string, handler: NotificationHandler): void {
		this.notificationHandlers.set(method, handler);
	}

	onRequest(method: string, handler: RequestHandler): void {
		this.requestHandlers.set(method, handler);
	}

	onClose(handler: () => void): void {
		this.closeHandlers.push(handler);
	}

	onError(handler: (error: Error) => void): void {
		this.errorHandlers.push(handler);
	}

	async sendRequest<T>(method: string, params?: unknown, options: JsonRpcRequestOptions = {}): Promise<T> {
		if (this.disposed) throw new Error("JSON-RPC connection is disposed");

		const id = this.nextRequestId;
		this.nextRequestId += 1;
		const key = String(id);
		const message = params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params };
		let requestWritten = false;
		let cancelAfterWrite = false;
		let settled = false;
		const writeCancel = (): Promise<void> => this.writeMessage({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } });

		const responsePromise = new Promise<T>((resolve, reject) => {
			const cleanup = (): void => {
				options.signal?.removeEventListener("abort", onAbort);
			};
			const settleCancel = (): void => {
				if (settled) return;
				settled = true;
				this.pendingRequests.delete(key);
				cleanup();
				const rejectCancelled = (): void => reject(abortError(options.signal));
				if (!requestWritten) {
					cancelAfterWrite = true;
					rejectCancelled();
					return;
				}
				void writeCancel().then(rejectCancelled, (error) => {
					this.emitError(toError(error));
					rejectCancelled();
				});
			};
			const onAbort = (): void => settleCancel();
			this.pendingRequests.set(key, {
				resolve(result) {
					settled = true;
					cleanup();
					resolve(result as T);
				},
				reject(error) {
					settled = true;
					cleanup();
					reject(error);
				},
				cleanup,
			});
			if (options.signal?.aborted) {
				settleCancel();
				return;
			}
			options.signal?.addEventListener("abort", onAbort, { once: true });
		});

		if (settled) return responsePromise;
		try {
			await this.writeMessage(message);
			requestWritten = true;
			if (cancelAfterWrite) await writeCancel();
		} catch (error) {
			if (settled) return responsePromise;
			const pending = this.pendingRequests.get(key);
			if (pending) {
				pending.cleanup();
				this.pendingRequests.delete(key);
			}
			throw error;
		}

		return responsePromise;
	}

	pendingRequestCount(): number {
		return this.pendingRequests.size;
	}

	async sendNotification(method: string, params?: unknown): Promise<void> {
		if (this.disposed) return;
		const message = params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params };
		await this.writeMessage(message);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.reader.off("data", this.handleData);
		this.reader.off("close", this.handleClose);
		this.reader.off("end", this.handleClose);
		this.reader.off("error", this.handleStreamError);
		this.writer.off("error", this.handleStreamError);
		for (const pending of this.pendingRequests.values()) {
			pending.cleanup();
			pending.reject(new Error("JSON-RPC connection disposed"));
		}
		this.pendingRequests.clear();
		this.notificationHandlers.clear();
		this.requestHandlers.clear();
	}

	private readonly handleData = (chunk: Buffer | string): void => {
		const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
		this.inputBuffer = Buffer.concat([this.inputBuffer, chunkBuffer]);
		this.drainInputBuffer();
	};

	private readonly handleClose = (): void => {
		for (const handler of this.closeHandlers) {
			handler();
		}
	};

	private readonly handleStreamError = (error: Error): void => {
		this.emitError(error);
	};

	private drainInputBuffer(): void {
		while (true) {
			const headerEnd = this.inputBuffer.indexOf(HEADER_SEPARATOR);
			if (headerEnd === -1) return;

			const headers = this.inputBuffer.subarray(0, headerEnd).toString("ascii");
			const contentLength = parseContentLength(headers);
			if (contentLength === null) {
				this.inputBuffer = Buffer.alloc(0);
				this.emitError(new Error("JSON-RPC message is missing Content-Length header"));
				return;
			}

			const bodyStart = headerEnd + Buffer.byteLength(HEADER_SEPARATOR);
			const bodyEnd = bodyStart + contentLength;
			if (this.inputBuffer.length < bodyEnd) return;

			const body = this.inputBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
			this.inputBuffer = this.inputBuffer.subarray(bodyEnd);
			this.dispatchBody(body);
		}
	}

	private dispatchBody(body: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch (error) {
			void this.writeError(null, PARSE_ERROR, error instanceof Error ? error.message : "Parse error").catch(
				(writeError) => this.emitError(toError(writeError)),
			);
			return;
		}

		if (!isJsonRpcObject(parsed)) {
			void this.writeError(null, INVALID_REQUEST, "Invalid JSON-RPC message").catch((error) =>
				this.emitError(toError(error)),
			);
			return;
		}

		if ("id" in parsed && ("result" in parsed || "error" in parsed)) {
			this.handleResponse(parsed);
			return;
		}

		if (typeof parsed["method"] !== "string") {
			const id = getMessageId(parsed) ?? null;
			void this.writeError(id, INVALID_REQUEST, "Invalid JSON-RPC method").catch((error) =>
				this.emitError(toError(error)),
			);
			return;
		}

		if ("id" in parsed) {
			this.handleRequest(parsed);
			return;
		}

		this.handleNotification(parsed["method"], parsed["params"]);
	}

	private handleResponse(message: Record<string, unknown>): void {
		const id = getMessageId(message);
		if (id === undefined) return;
		const pending = this.pendingRequests.get(String(id));
		if (!pending) return;
		this.pendingRequests.delete(String(id));
		pending.cleanup();

		if ("error" in message) {
			pending.reject(jsonRpcErrorToError(message["error"]));
			return;
		}

		pending.resolve(message["result"]);
	}

	private handleNotification(method: string, params: unknown): void {
		const handler = this.notificationHandlers.get(method);
		if (!handler) return;
		try {
			handler(params);
		} catch (error) {
			if (error instanceof Error) {
				this.emitError(error);
				return;
			}
			this.emitError(new Error(String(error)));
		}
	}

	private handleRequest(message: Record<string, unknown>): void {
		const id = getMessageId(message);
		if (id === undefined) {
			void this.writeError(null, INVALID_REQUEST, "Invalid JSON-RPC id").catch((error) =>
				this.emitError(toError(error)),
			);
			return;
		}

		const method = typeof message["method"] === "string" ? message["method"] : "";
		const handler = this.requestHandlers.get(method);
		if (!handler) {
			void this.writeError(id, METHOD_NOT_FOUND, `Method not found: ${method}`).catch((error) =>
				this.emitError(toError(error)),
			);
			return;
		}

		Promise.resolve()
			.then(() => handler(message["params"]))
			.then(
				(result) => this.writeMessage({ jsonrpc: "2.0", id, result }),
				(error) => this.writeError(id, INTERNAL_ERROR, toError(error).message),
			)
			.catch((error) => this.emitError(toError(error)));
	}

	private async writeError(id: JsonRpcId, code: number, message: string): Promise<void> {
		await this.writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
	}

	private writeMessage(message: Record<string, unknown>): Promise<void> {
		const body = JSON.stringify(message);
		const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
		return new Promise((resolve, reject) => {
			this.writer.write(payload, (error?: Error | null) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	}

	private emitError(error: Error): void {
		for (const handler of this.errorHandlers) {
			handler(error);
		}
	}
}

function abortError(signal: AbortSignal | undefined): Error {
	const reason = signal?.reason;
	if (reason instanceof Error) return reason;
	const error = new Error(typeof reason === "string" ? reason : "LSP request cancelled");
	error.name = "AbortError";
	return error;
}

function parseContentLength(headers: string): number | null {
	for (const line of headers.split("\r\n")) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex === -1) continue;
		const name = line.slice(0, separatorIndex).trim().toLowerCase();
		if (name !== "content-length") continue;
		const value = Number.parseInt(line.slice(separatorIndex + 1).trim(), 10);
		return Number.isFinite(value) && value >= 0 ? value : null;
	}
	return null;
}

function isJsonRpcObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getMessageId(message: Record<string, unknown>): JsonRpcId | undefined {
	const id = message["id"];
	if (typeof id === "number" || typeof id === "string" || id === null) return id;
	return undefined;
}

function jsonRpcErrorToError(value: unknown): Error {
	if (!isJsonRpcObject(value)) return new Error("JSON-RPC request failed");
	const message = typeof value["message"] === "string" ? value["message"] : "JSON-RPC request failed";
	const error = new Error(message);
	if (typeof value["code"] === "number") {
		error.name = `JsonRpcError(${value["code"]})`;
	}
	return error;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
