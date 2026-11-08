/**
 * Messages between the QuickJS run worker and the host. Type-only: the worker imports nothing but
 * types from here, so it runs from source under Node's type stripping and from its own bundle.
 */

/** Per-run limits the worker enforces itself (the host enforces the wall clock and the call count). */
export interface SandboxWorkerLimits {
	/** QuickJS `memoryLimit`, bytes. */
	readonly memoryBytes: number;
	/** Console output kept per run, UTF-8 bytes; the rest is cut with a marker. */
	readonly outputBytes: number;
	/** Serialized return value kept per run, UTF-8 bytes; past it the value becomes a marked string. */
	readonly returnBytes: number;
	/** Serialized argument list of one bridged call, UTF-8 bytes; past it the call rejects in the VM. */
	readonly argsBytes: number;
}

export interface SandboxWorkerData {
	readonly code: string;
	/** Absolute path of `quickjs.wasm`. */
	readonly wasmPath: string;
	/** One Int32 the host sets to interrupt the VM at its next checkpoint. */
	readonly interrupt: SharedArrayBuffer;
	/** Names of the VM globals that call the host. */
	readonly bridge: readonly string[];
	/** VM-side setup run after the prelude, before the body. */
	readonly setup?: SandboxSetup;
	readonly limits: SandboxWorkerLimits;
}

/**
 * VM source of a function `(callHost, data) => void`, evaluated in the VM and called once before the body:
 * `callHost(name, args)` is the prelude's bridged call (a promise), `data` is the string `data` below.
 */
export interface SandboxSetup {
	readonly source: string;
	readonly data: string;
}

/** An error that left the VM, described as data. */
export interface SandboxErrorPayload {
	readonly name: string;
	readonly message: string;
	readonly stack?: string;
	/** Set by the VM-side `assert` and the boundary checks (`ComputerRunError` reasons). */
	readonly reason?: string;
	/** JSON of a thrown non-object value (`throw "x"`), rethrown as that value on the host. */
	readonly thrown?: string;
	/**
	 * A bridged call's host error: the host keeps the error under this token and rethrows it unchanged when the
	 * VM error carrying the token leaves the run uncaught.
	 */
	readonly hostError?: string;
	/** The host error's `data` (JSON) and JSON-RPC `rpcCode`, readable by the body that catches it. */
	readonly data?: unknown;
	readonly rpcCode?: number;
}

export type WorkerToHostMessage =
	| { readonly type: "output"; readonly text: string }
	| { readonly type: "call"; readonly id: number; readonly name: string; readonly args: string }
	| { readonly type: "done"; readonly ok: true; readonly value?: string }
	| { readonly type: "done"; readonly ok: false; readonly error: SandboxErrorPayload };

/**
 * The answer to one `call`: `payload` is JSON of the value (ok) or of a `SandboxErrorPayload`. An ok answer without
 * `payload` is a value of `undefined`, which JSON cannot carry; the VM resolves the call with `undefined`.
 */
export interface HostToWorkerMessage {
	readonly type: "settle";
	readonly id: number;
	readonly ok: boolean;
	readonly payload?: string;
}
