import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { EngineMethod, ErrorCode, JsonRpcErrorData } from "@oh-my-opencode/senpi-desktop-protocol";
import { EngineChild } from "./child";
import { isRecord, parseErrorData } from "./parse";
import { GRACE_MS, RESTART_MESSAGE } from "./timeouts";

/** Failures the service itself produces; engine failures are `DesktopEngineRpcError`. */
export type DesktopServiceErrorCode = Extract<ErrorCode, "Timeout" | "Cancelled" | "Closed" | "Internal">;

export class DesktopServiceError extends Error {
	readonly code: DesktopServiceErrorCode;
	/** The child was killed for ignoring `$/cancel`; the next call starts a fresh engine. */
	readonly engineRestarted: boolean;

	constructor(code: DesktopServiceErrorCode, message: string, engineRestarted = false) {
		super(message);
		this.name = "DesktopServiceError";
		this.code = code;
		this.engineRestarted = engineRestarted;
	}
}

/** An error reply from the engine, carried verbatim. */
export class DesktopEngineRpcError extends Error {
	readonly method: EngineMethod;
	readonly rpcCode: number;
	readonly data: JsonRpcErrorData | null;

	constructor(
		method: EngineMethod,
		error: { readonly code: number; readonly message: string; readonly data: unknown },
	) {
		super(error.message);
		this.name = "DesktopEngineRpcError";
		this.method = method;
		this.rpcCode = error.code;
		this.data = parseErrorData(error.data);
	}
}

export interface CallOptions {
	/** Abort sends `$/cancel`; the engine then has `GRACE_MS` to answer before the child is killed. */
	readonly signal?: AbortSignal;
	/** Expiry sends `$/cancel` with the same grace. */
	readonly timeoutMs?: number;
}

export interface RpcClientHooks {
	readonly onNotification: (method: string, params: unknown) => void;
	readonly onExit: () => void;
}

interface Pending {
	readonly method: EngineMethod;
	readonly resolve: (result: unknown) => void;
	readonly reject: (error: Error) => void;
	/** Timers and the abort listener; mutable because `$/cancel` swaps the deadline for the grace timer. */
	release: () => void;
	cancelled: DesktopServiceError | undefined;
}

/** Id-multiplexed JSON-RPC over one engine child: replies may arrive in any order. */
export class RpcClient {
	readonly #child: EngineChild;
	readonly #hooks: RpcClientHooks;
	readonly #pending = new Map<number, Pending>();
	#nextId = 1;
	#exitReason: string | undefined;

	constructor(process: ChildProcessWithoutNullStreams, hooks: RpcClientHooks) {
		this.#hooks = hooks;
		this.#child = new EngineChild(process, {
			onLine: (line) => this.#onLine(line),
			onExit: (reason) => this.#onExit(reason),
		});
	}

	get enginePath(): string {
		return this.#child.path;
	}

	/** False from the moment the child is killed or exits, before its `close` event arrives. */
	get alive(): boolean {
		return this.#exitReason === undefined && this.#child.alive;
	}

	get exited(): Promise<void> {
		return this.#child.exited;
	}

	request(method: EngineMethod, params: unknown, options: CallOptions = {}): Promise<unknown> {
		if (!this.alive) {
			return Promise.reject(new DesktopServiceError("Closed", this.#exitReason ?? "desktop engine was killed"));
		}
		if (options.signal?.aborted) {
			return Promise.reject(new DesktopServiceError("Cancelled", `${method} was cancelled before it was sent`));
		}
		const id = this.#nextId++;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const pending: Pending = { method, resolve, reject, release: () => undefined, cancelled: undefined };
		this.#pending.set(id, pending);
		const { signal, timeoutMs } = options;
		const onAbort = () => this.#cancel(id, new DesktopServiceError("Cancelled", `${method} was cancelled`));
		const timer =
			timeoutMs === undefined
				? undefined
				: setTimeout(
						() =>
							this.#cancel(id, new DesktopServiceError("Timeout", `${method} timed out after ${timeoutMs} ms`)),
						timeoutMs,
					);
		signal?.addEventListener("abort", onAbort, { once: true });
		pending.release = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		this.#child.write({ id, method, params });
		return promise;
	}

	/** Ends stdin; the engine exits at EOF. */
	end(): void {
		this.#child.end();
	}

	kill(): void {
		this.#child.kill();
	}

	#cancel(id: number, reason: DesktopServiceError): void {
		const pending = this.#pending.get(id);
		if (pending === undefined || pending.cancelled !== undefined) return;
		pending.release();
		pending.cancelled = reason;
		const grace = setTimeout(() => {
			this.#settle(id);
			pending.reject(new DesktopServiceError(reason.code, `${reason.message}; ${RESTART_MESSAGE}`, true));
			this.#child.kill();
		}, GRACE_MS);
		pending.release = () => clearTimeout(grace);
		this.#child.write({ method: "$/cancel", params: { id } });
	}

	#settle(id: number): Pending | undefined {
		const pending = this.#pending.get(id);
		this.#pending.delete(id);
		pending?.release();
		return pending;
	}

	#onLine(line: string): void {
		const message = parseLine(line);
		if (!isRecord(message)) {
			this.#child.kill();
			this.#exitReason = `desktop engine wrote a non-protocol line ${JSON.stringify(line.slice(0, 200))}`;
			return;
		}
		if (typeof message.method === "string" && message.id === undefined) {
			this.#hooks.onNotification(message.method, message.params);
			return;
		}
		// A reply for an id no longer pending was already settled by the grace kill: nothing awaits it.
		const pending = typeof message.id === "number" ? this.#settle(message.id) : undefined;
		if (pending === undefined) return;
		if (pending.cancelled !== undefined) {
			pending.reject(pending.cancelled);
			return;
		}
		if ("result" in message) {
			pending.resolve(message.result);
			return;
		}
		const { error } = message;
		if (isRecord(error) && typeof error.code === "number" && typeof error.message === "string") {
			pending.reject(
				new DesktopEngineRpcError(pending.method, { code: error.code, message: error.message, data: error.data }),
			);
			return;
		}
		pending.reject(new DesktopServiceError("Internal", `desktop engine sent a malformed reply to ${pending.method}`));
	}

	#onExit(reason: string): void {
		this.#exitReason ??= reason;
		const closed = new DesktopServiceError("Closed", this.#exitReason);
		for (const id of [...this.#pending.keys()]) this.#settle(id)?.reject(closed);
		this.#hooks.onExit();
	}
}

function parseLine(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
}
