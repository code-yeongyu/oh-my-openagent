/**
 * Worker thread entry of the QuickJS run cell: one worker runs one `run` body in a fresh QuickJS VM
 * (its own wasm instance) and reports to the host over `parentPort`. The host terminates the worker
 * when the run settles, times out, or is aborted, so a spinning body never blocks the host thread.
 *
 * Runs unbundled from source (Node type stripping, Bun) and as its own plugin bundle, so it imports
 * only node builtins, `quickjs-wasi`, and types.
 */
import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { JSException, type JSValueHandle, MAX_STACK_SIZE, QuickJS } from "quickjs-wasi";
import type { HostToWorkerMessage, SandboxErrorPayload, SandboxWorkerData, WorkerToHostMessage } from "./protocol.ts";

// VM-side setup, evaluated before the body. Everything the body can reach is defined here, in the
// VM's realm; the only way out is `bridge`, which takes and returns strings.
const PRELUDE = `(bridge, names) => {
	delete globalThis.SharedArrayBuffer;
	const pending = new Map();
	let nextId = 1;
	const runError = (reason, message) => {
		const error = new Error(message);
		error.name = "ComputerRunError";
		error.reason = reason;
		return error;
	};
	const boundary = (key, value) => {
		const kind = typeof value;
		if (kind === "function" || kind === "symbol" || kind === "bigint" || value instanceof RegExp ||
			(kind === "number" && !Number.isFinite(value))) {
			throw new TypeError("computer run: a " + (value instanceof RegExp ? "RegExp" : kind) + " cannot cross the sandbox boundary");
		}
		return value;
	};
	const callHost = (name, args) => new Promise((resolve, reject) => {
		const json = JSON.stringify(args, boundary);
		const id = nextId++;
		const refusal = bridge("call", id, name, json);
		if (refusal !== undefined) {
			reject(runError("payloadSize", "computer run: the arguments of " + name + " are " + refusal));
			return;
		}
		pending.set(id, { resolve, reject });
	});
	for (const name of JSON.parse(names)) globalThis[name] = (...args) => callHost(name, args);
	const show = (value) => {
		if (typeof value === "string") return value;
		try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
	};
	const print = (...values) => { bridge("output", values.map(show).join(" ")); };
	globalThis.console = { log: print, info: print, warn: print, error: print, debug: print };
	globalThis.assert = (condition, message) => {
		if (!condition) throw runError("assertion", message ?? "Assertion failed");
	};
	return {
		run(body) {
			body().then((value) => {
				let json;
				if (value !== undefined) {
					try { json = JSON.stringify(value) ?? "null"; } catch { json = JSON.stringify(String(value)); }
				}
				bridge("done", true, json);
			}, (error) => bridge("done", false, error));
		},
		settle(id, ok, payload) {
			const call = pending.get(id);
			if (call === undefined) return;
			pending.delete(id);
			const data = payload === undefined ? undefined : JSON.parse(payload);
			if (ok) call.resolve(data);
			else call.reject(runError(data.reason, data.message));
		},
		pending: () => pending.size,
	};
}`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function post(message: WorkerToHostMessage): void {
	parentPort?.postMessage(message);
}

function byteLength(text: string): number {
	return encoder.encode(text).byteLength;
}

/** The first `bytes` UTF-8 bytes of `text`; a code point cut in half decodes as U+FFFD. */
function prefix(text: string, bytes: number): string {
	return decoder.decode(encoder.encode(text).subarray(0, Math.max(0, bytes)));
}

/** QuickJS writes engine diagnostics to fd 1 and 2; they belong to nobody, so every byte is reported written and dropped. */
function discardOutput(memory: { readonly buffer: ArrayBufferLike }) {
	return {
		fd_write(_fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
			const view = new DataView(memory.buffer);
			let written = 0;
			for (let i = 0; i < iovsLen; i++) written += view.getUint32(iovsPtr + i * 8 + 4, true);
			view.setUint32(nwrittenPtr, written, true);
			return 0;
		},
	};
}

function stringProp(handle: JSValueHandle, key: string): string | undefined {
	const value = handle.getProp(key);
	try {
		return value.isString ? value.toString() : undefined;
	} finally {
		value.dispose();
	}
}

function describeThrown(vm: QuickJS, thrown: JSValueHandle): SandboxErrorPayload {
	if (!thrown.isObject) {
		return { name: "Error", message: "", thrown: JSON.stringify(vm.dump(thrown)) ?? "null" };
	}
	const stack = stringProp(thrown, "stack");
	const reason = stringProp(thrown, "reason");
	return {
		name: stringProp(thrown, "name") ?? "Error",
		message: stringProp(thrown, "message") ?? "",
		...(stack === undefined ? {} : { stack }),
		...(reason === undefined ? {} : { reason }),
	};
}

function exceptionPayload(error: JSException): SandboxErrorPayload {
	return { name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) };
}

async function main(data: SandboxWorkerData): Promise<void> {
	const { limits } = data;
	const interrupt = new Int32Array(data.interrupt);
	const vm = await QuickJS.create({
		wasm: await readFile(data.wasmPath),
		memoryLimit: limits.memoryBytes,
		// Without the guard deep recursion overflows the wasm stack and traps instead of throwing a RangeError.
		maxStackSize: MAX_STACK_SIZE,
		interruptHandler: () => Atomics.load(interrupt, 0) !== 0,
		wasi: discardOutput,
	});

	let finished = false;
	const finish = (message: WorkerToHostMessage) => {
		if (finished) return;
		finished = true;
		post(message);
	};
	let outputLeft = limits.outputBytes;
	let outputCut = false;
	const output = (text: string) => {
		if (outputCut) return;
		const size = byteLength(text);
		if (size <= outputLeft) {
			outputLeft -= size;
			post({ type: "output", text });
			return;
		}
		post({ type: "output", text: `${prefix(text, outputLeft)}[output truncated: cap ${limits.outputBytes} bytes]` });
		outputCut = true;
	};
	const returned = (json: string | undefined) => {
		if (json === undefined) return finish({ type: "done", ok: true });
		const size = byteLength(json);
		if (size <= limits.returnBytes) return finish({ type: "done", ok: true, value: json });
		const marker = `[return value truncated: ${size} bytes, cap ${limits.returnBytes} bytes]`;
		finish({ type: "done", ok: true, value: JSON.stringify(prefix(json, limits.returnBytes - byteLength(marker)) + marker) });
	};

	const bridge = vm.newFunction("bridge", (kind, a, b, c) => {
		switch (kind.toString()) {
			case "call": {
				const args = c.toString();
				const size = byteLength(args);
				if (size > limits.argsBytes) return vm.newString(`${size} bytes, over the ${limits.argsBytes}-byte cap`);
				post({ type: "call", id: a.toNumber(), name: b.toString(), args });
				return vm.undefined;
			}
			case "output":
				output(a.toString());
				return vm.undefined;
			case "done":
				if (a.toBoolean()) returned(b.isUndefined ? undefined : b.toString());
				else finish({ type: "done", ok: false, error: describeThrown(vm, b) });
				return vm.undefined;
			default:
				return vm.undefined;
		}
	});

	// The VM lives until the host terminates the worker, so these handles are never disposed.
	const api = vm.withScope((scope) =>
		scope.escape(vm.callFunction(vm.evalCode(PRELUDE, "computer-run-prelude.js"), vm.undefined, bridge, vm.newString(JSON.stringify(data.bridge)))),
	);
	const run = api.getProp("run");
	const settle = api.getProp("settle");
	const pendingCalls = api.getProp("pending");
	// Run queued jobs, then fail a body that awaits nothing the host can ever settle.
	const drain = () => {
		vm.executePendingJobs();
		if (finished) return;
		const pending = vm.callFunction(pendingCalls, api);
		const waiting = pending.toNumber();
		pending.dispose();
		if (waiting === 0) {
			finish({
				type: "done",
				ok: false,
				error: { name: "ComputerRunError", reason: "stalled", message: "computer run stalled: the body awaits a promise nothing can settle" },
			});
		}
	};

	parentPort?.on("message", (message: HostToWorkerMessage) => {
		vm.withScope(() => {
			vm.callFunction(
				settle,
				api,
				vm.newNumber(message.id),
				message.ok ? vm.true : vm.false,
				message.payload === undefined ? vm.undefined : vm.newString(message.payload),
			);
		});
		drain();
	});

	let body: JSValueHandle;
	try {
		// The body shares the wrapper's second line, so reported line numbers are the body's own plus one.
		body = vm.evalCode(`(async () => {\n${data.code}\n})`, "computer-run.js");
	} catch (error) {
		if (!(error instanceof JSException)) throw error;
		finish({ type: "done", ok: false, error: exceptionPayload(error) });
		return;
	}
	vm.callFunction(run, api, body).dispose();
	body.dispose();
	drain();
}

// An uncaught failure here is a worker `error`, which the host settles as `crashed`.
void main(workerData as SandboxWorkerData);
