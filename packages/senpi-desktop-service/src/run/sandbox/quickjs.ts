import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ComputerDisplay, ComputerRunOk, ComputerSessionSnapshot } from "@oh-my-opencode/senpi-desktop-protocol";
import type { DesktopService } from "../../service/service";
import { ComputerRunError, type ComputerRunErrorReason } from "../context";
import {
	SANDBOX_ARGS_BYTES,
	SANDBOX_MAX_CALLS,
	SANDBOX_MEMORY_BYTES,
	SANDBOX_OUTPUT_BYTES,
	SANDBOX_RESULT_BYTES,
	SANDBOX_RETURN_BYTES,
} from "./limits";
import type { HostToWorkerMessage, SandboxErrorPayload, SandboxWorkerData, WorkerToHostMessage } from "./protocol";

/** A host function bridged into the VM under its name; its arguments and result cross as JSON. */
export type SandboxBridgedCall = (args: readonly unknown[], signal: AbortSignal) => Promise<unknown>;

export interface QuickJsRunRequest {
	readonly code: string;
	readonly snapshot: ComputerSessionSnapshot;
	/** Counted from submission, so time spent queued behind the session's previous run counts. */
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
}

export interface QuickJsRunHost {
	readonly service: Pick<DesktopService, "revokeControl" | "reportError">;
}

export interface QuickJsRunOptions {
	/** VM globals that call the host. The shipped cell bridges none; the `computer` bridge is a later row. */
	readonly bridge?: Readonly<Record<string, SandboxBridgedCall>>;
	/** The worker entry; defaults to the shipped one. */
	readonly workerPath?: string;
}

/** The worker bundle and the wasm the omo-senpi build emits beside the bundle this module is inlined into. */
const SANDBOX_WORKER_BUNDLE_NAME = "omo-computer-run-worker.mjs";
const SANDBOX_WASM_BUNDLE_NAME = "quickjs.wasm";

// A bundler cannot inline a Worker's entry, so inside a bundle both files are its siblings; from source
// they are worker.ts next to this file and the installed quickjs-wasi package's wasm.
function sandboxFiles(moduleUrl: string): { readonly worker: string; readonly wasm: string } {
	const bundledWorker = fileURLToPath(new URL(`./${SANDBOX_WORKER_BUNDLE_NAME}`, moduleUrl));
	const bundledWasm = fileURLToPath(new URL(`./${SANDBOX_WASM_BUNDLE_NAME}`, moduleUrl));
	return existsSync(bundledWorker)
		? { worker: bundledWorker, wasm: bundledWasm }
		: {
				worker: fileURLToPath(new URL("./worker.ts", moduleUrl)),
				wasm: createRequire(moduleUrl).resolve("quickjs-wasi/quickjs.wasm"),
			};
}

// Reasons a body can raise itself (assert, a refused bridged call, the stall check); the limits the
// host enforces cannot be claimed by a thrown object.
const VM_REASONS: ReadonlySet<string> = new Set<ComputerRunErrorReason>([
	"assertion",
	"payloadSize",
	"stalled",
	"readOnly",
	"window",
	"wait",
	"unavailable",
]);

const HOST_ERRORS: Readonly<Record<string, new (message: string) => Error>> = {
	EvalError,
	RangeError,
	ReferenceError,
	SyntaxError,
	TypeError,
	URIError,
};

/** Rebuilds an error that left the VM as a host value with the same name and message. */
function hostError(payload: SandboxErrorPayload): unknown {
	if (payload.thrown !== undefined) return JSON.parse(payload.thrown);
	const { name, message } = payload;
	if (name === "ComputerRunError" && payload.reason !== undefined && VM_REASONS.has(payload.reason)) {
		return new ComputerRunError(payload.reason as ComputerRunErrorReason, message);
	}
	if (name === "InternalError" && message === "out of memory") {
		return new ComputerRunError("memory", `computer run exceeded its ${SANDBOX_MEMORY_BYTES}-byte heap`);
	}
	if (name === "RangeError" && message === "Maximum call stack size exceeded") {
		return new ComputerRunError("stack", "computer run exceeded its stack limit");
	}
	const Constructor = HOST_ERRORS[name];
	const error = Constructor === undefined ? new Error(message) : new Constructor(message);
	if (Constructor === undefined) error.name = name;
	if (payload.stack !== undefined) error.stack = payload.stack;
	return error;
}

function bridgedFailure(error: unknown): SandboxErrorPayload {
	if (error instanceof ComputerRunError) return { name: error.name, message: error.message, reason: error.reason };
	throw error;
}

// One live worker per desktop session: a run waits FIFO for the session's previous run to settle.
const sessionTails = new Map<string, Promise<void>>();

function untilSignal(promise: Promise<void>, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		if (signal.aborted) return onAbort();
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		});
	});
}

/**
 * Runs `code` (an async function body) in a fresh QuickJS VM on a worker thread. Inside the VM only
 * `assert` and `console` exist besides the language itself (plus `options.bridge`); everything crosses
 * as JSON. A failed run revokes the control grant, as a failed vm run does.
 */
export async function runQuickJsCode(
	request: QuickJsRunRequest,
	host: QuickJsRunHost,
	options: QuickJsRunOptions = {},
): Promise<ComputerRunOk> {
	const { timeoutMs } = request;
	const controller = new AbortController();
	const { signal } = controller;
	const timer = setTimeout(
		() => controller.abort(new ComputerRunError("timeout", `computer run timed out after ${timeoutMs} ms`)),
		timeoutMs,
	);
	const onCallerAbort = () => controller.abort(new ComputerRunError("aborted", "computer run was aborted"));
	request.signal?.addEventListener("abort", onCallerAbort, { once: true });
	if (request.signal?.aborted) onCallerAbort();

	const sessionId = request.snapshot.sessionId;
	const previous = sessionTails.get(sessionId) ?? Promise.resolve();
	let release = () => {};
	const mine = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.then(() => mine);
	sessionTails.set(sessionId, tail);
	try {
		await untilSignal(previous, signal);
		return await runInWorker(request.code, signal, options);
	} catch (error) {
		void host.service.revokeControl().catch((revokeError: unknown) => host.service.reportError(revokeError));
		throw error;
	} finally {
		clearTimeout(timer);
		request.signal?.removeEventListener("abort", onCallerAbort);
		if (!signal.aborted) controller.abort(new ComputerRunError("ended", "computer run has ended"));
		release();
		if (sessionTails.get(sessionId) === tail) sessionTails.delete(sessionId);
	}
}

function runInWorker(code: string, signal: AbortSignal, options: QuickJsRunOptions): Promise<ComputerRunOk> {
	const bridge = options.bridge ?? {};
	let workerPath: string;
	let wasmPath: string;
	try {
		const files = sandboxFiles(import.meta.url);
		workerPath = options.workerPath ?? files.worker;
		wasmPath = files.wasm;
		if (!existsSync(wasmPath)) throw new Error(`missing ${wasmPath}`);
	} catch (error) {
		return Promise.reject(
			new ComputerRunError("crashed", `the QuickJS run cell could not be loaded: ${error instanceof Error ? error.message : String(error)}`),
		);
	}
	const interrupt = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
	const data: SandboxWorkerData = {
		code,
		wasmPath,
		interrupt,
		bridge: Object.keys(bridge),
		limits: {
			memoryBytes: SANDBOX_MEMORY_BYTES,
			outputBytes: SANDBOX_OUTPUT_BYTES,
			returnBytes: SANDBOX_RETURN_BYTES,
			argsBytes: SANDBOX_ARGS_BYTES,
		},
	};

	return new Promise<ComputerRunOk>((resolve, reject) => {
		signal.throwIfAborted();
		const worker = new Worker(workerPath, { workerData: data });
		const displays: ComputerDisplay[] = [];
		let settled = false;
		let calls = 0;
		let queue = Promise.resolve();
		// `worker.terminate()` is the wall enforcement of record: the interrupt flag stops ordinary loops at
		// the next interpreter checkpoint, terminate also ends a single long builtin that never reaches one.
		const stop = () => {
			Atomics.store(new Int32Array(interrupt), 0, 1);
			void worker.terminate();
		};
		const settle = (outcome: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			stop();
			outcome();
		};
		const fail = (error: unknown) => settle(() => reject(error));
		const onAbort = () => fail(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });

		const answer = (message: HostToWorkerMessage) => {
			if (!settled) worker.postMessage(message);
		};
		const callHost = async (id: number, call: SandboxBridgedCall, argsJson: string) => {
			let payload: string | undefined;
			try {
				const args: unknown = JSON.parse(argsJson);
				const value = await call(Array.isArray(args) ? args : [], signal);
				payload = value === undefined ? undefined : JSON.stringify(value);
			} catch (error) {
				answer({ type: "settle", id, ok: false, payload: JSON.stringify(bridgedFailure(error)) });
				return;
			}
			const size = payload === undefined ? 0 : Buffer.byteLength(payload);
			if (size > SANDBOX_RESULT_BYTES) {
				const failure = { name: "ComputerRunError", reason: "payloadSize", message: `computer run: the result is ${size} bytes, over the ${SANDBOX_RESULT_BYTES}-byte cap` };
				answer({ type: "settle", id, ok: false, payload: JSON.stringify(failure) });
				return;
			}
			answer({ type: "settle", id, ok: true, ...(payload === undefined ? {} : { payload }) });
		};

		worker.on("message", (message: WorkerToHostMessage) => {
			if (settled) return;
			switch (message.type) {
				case "output":
					displays.push({ type: "text", text: message.text });
					return;
				case "call": {
					calls++;
					if (calls > SANDBOX_MAX_CALLS) {
						fail(new ComputerRunError("calls", `computer run made more than ${SANDBOX_MAX_CALLS} host calls`));
						return;
					}
					const call = Object.hasOwn(bridge, message.name) ? bridge[message.name] : undefined;
					if (call === undefined) {
						fail(new ComputerRunError("crashed", `the QuickJS run cell called an unknown host function '${message.name}'`));
						return;
					}
					// One host call at a time, FIFO: a second call waits for the first to settle.
					queue = queue.then(() => callHost(message.id, call, message.args)).catch(fail);
					return;
				}
				case "done":
					if (message.ok) {
						const returnValue: unknown = message.value === undefined ? undefined : JSON.parse(message.value);
						settle(() => resolve({ displays, returnValue, screenshots: [], audit: [] }));
					} else {
						fail(hostError(message.error));
					}
					return;
			}
		});
		worker.on("error", (error: unknown) =>
			fail(new ComputerRunError("crashed", `the QuickJS run cell crashed: ${error instanceof Error ? error.message : String(error)}`)),
		);
		worker.on("exit", (exitCode) => fail(new ComputerRunError("crashed", `the QuickJS run cell exited with code ${exitCode} before the run settled`)));
	});
}
