import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ComputerDisplay, ComputerRunOk, ComputerSessionSnapshot } from "@oh-my-opencode/senpi-desktop-protocol";
import type { DesktopService } from "../../service/service";
import { ComputerRunError, type ComputerRunErrorReason, type RunOutput } from "../context";
import {
	SANDBOX_ARGS_BYTES,
	SANDBOX_MAX_CALLS,
	SANDBOX_MEMORY_BYTES,
	SANDBOX_OUTPUT_BYTES,
	SANDBOX_RESULT_BYTES,
	SANDBOX_RETURN_BYTES,
} from "./limits";
import type {
	HostToWorkerMessage,
	SandboxErrorPayload,
	SandboxSetup,
	SandboxWorkerData,
	WorkerToHostMessage,
} from "./protocol";

/** A bridged result its bridge serialized itself (with its own replacer); copied into the VM as this JSON text. */
export class BridgedJson {
	readonly json: string;

	constructor(json: string) {
		this.json = json;
	}
}

/**
 * A host function bridged into the VM under its name; its arguments and result cross as JSON. A rejection is
 * catchable in the body; when the body lets it escape, the run rejects with the host's own error object.
 */
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
	/** VM globals that call the host (`run/sandbox/bridge.ts` bridges `computer`). */
	readonly bridge?: Readonly<Record<string, SandboxBridgedCall>>;
	/** VM-side setup run before the body, given the bridged-call function (the `computer` stubs). */
	readonly setup?: SandboxSetup;
	/** Where console output goes, shared with bridged calls that display (screenshots); the run's displays are its entries. */
	readonly output?: RunOutput;
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
	"resultSize",
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

/**
 * Rebuilds an error that left the VM as a host value with the same name and message; a bridged call's error the
 * body let escape is the host's own error object again.
 */
function hostError(payload: SandboxErrorPayload, hostErrors: ReadonlyMap<string, unknown>): unknown {
	if (payload.hostError !== undefined && hostErrors.has(payload.hostError)) return hostErrors.get(payload.hostError);
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

/** JSON of a value, or undefined when it has none (a cycle, a bigint). */
function jsonOrUndefined(value: unknown): unknown {
	try {
		const json = JSON.stringify(value);
		return json === undefined ? undefined : JSON.parse(json);
	} catch {
		return undefined;
	}
}

/**
 * A bridged call's failure as the VM sees it: name, message, and the whitelisted fields a vm body can read on the
 * host error (`reason`, `data`, `rpcCode`, `DesktopServiceError.code`/`.engineRestarted`,
 * `DesktopEngineRpcError.method`); no other field crosses.
 */
function bridgedFailure(error: unknown, token: string): SandboxErrorPayload {
	if (!(error instanceof Error)) return { name: "Error", message: String(error), hostError: token };
	const fields: Record<string, unknown> = { ...error };
	const reason = typeof fields.reason === "string" ? fields.reason : undefined;
	const data = fields.data === undefined || fields.data === null ? undefined : jsonOrUndefined(fields.data);
	const rpcCode = typeof fields.rpcCode === "number" ? fields.rpcCode : undefined;
	const code = typeof fields.code === "string" ? fields.code : undefined;
	const engineRestarted = typeof fields.engineRestarted === "boolean" ? fields.engineRestarted : undefined;
	const method = typeof fields.method === "string" ? fields.method : undefined;
	return {
		name: error.name,
		message: error.message,
		hostError: token,
		...(reason === undefined ? {} : { reason }),
		...(data === undefined ? {} : { data }),
		...(rpcCode === undefined ? {} : { rpcCode }),
		...(code === undefined ? {} : { code }),
		...(engineRestarted === undefined ? {} : { engineRestarted }),
		...(method === undefined ? {} : { method }),
	};
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
 * `assert` and `console` exist besides the language itself (plus `options.bridge` and what `options.setup`
 * defines over it); everything crosses as JSON. A failed run revokes the control grant, as a failed vm run does.
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
		...(options.setup === undefined ? {} : { setup: options.setup }),
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
		const { output } = options;
		// Errors of bridged calls, by the token the VM error carries, so one the body lets escape is rethrown as is.
		const hostErrors = new Map<string, unknown>();
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
				payload = value instanceof BridgedJson ? value.json : value === undefined ? undefined : JSON.stringify(value);
			} catch (error) {
				const token = String(hostErrors.size + 1);
				hostErrors.set(token, error);
				answer({ type: "settle", id, ok: false, payload: JSON.stringify(bridgedFailure(error, token)) });
				return;
			}
			const size = payload === undefined ? 0 : Buffer.byteLength(payload);
			if (size > SANDBOX_RESULT_BYTES) {
				const failure = { name: "ComputerRunError", reason: "resultSize", message: `computer run: the result is ${size} bytes, over the ${SANDBOX_RESULT_BYTES}-byte cap` };
				answer({ type: "settle", id, ok: false, payload: JSON.stringify(failure) });
				return;
			}
			answer({ type: "settle", id, ok: true, ...(payload === undefined ? {} : { payload }) });
		};

		worker.on("message", (message: WorkerToHostMessage) => {
			if (settled) return;
			switch (message.type) {
				case "output":
					if (output === undefined) displays.push({ type: "text", text: message.text });
					else output.text(message.text);
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
						const shown = output === undefined ? displays : output.finish();
						settle(() => resolve({ displays: shown, returnValue, screenshots: [], audit: [] }));
					} else {
						fail(hostError(message.error, hostErrors));
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
