import type {
	ComputerCallPolicy,
	ComputerDisplay,
	ComputerScreenshot,
	ComputerSessionSnapshot,
	EngineMethod,
} from "@oh-my-opencode/senpi-desktop-protocol";

/** Why a computer run failed inside the runtime; engine failures surface as `DesktopEngineRpcError`. */
export type ComputerRunErrorReason = "readOnly" | "timeout" | "aborted" | "ended" | "assertion" | "window" | "wait";

export class ComputerRunError extends Error {
	readonly reason: ComputerRunErrorReason;

	constructor(reason: ComputerRunErrorReason, message: string) {
		super(message);
		this.name = "ComputerRunError";
		this.reason = reason;
	}
}

/** Ordered text and image entries shown to the model; an accumulator, so it is mutable by design. */
export class RunOutput {
	readonly #entries: ComputerDisplay[] = [];

	text(text: string): void {
		this.#entries.push({ type: "text", text });
	}

	image(data: string, mimeType: string): void {
		this.#entries.push({ type: "image", data, mimeType });
	}

	finish(): readonly ComputerDisplay[] {
		return [...this.#entries];
	}
}

/**
 * The state one run owns. Each run gets its own vm context and a facade bound to this object, so
 * async work leaked from an ended run keeps that run's aborted signal and read-only policy instead of
 * borrowing the next run's (what oh-my-pi's AsyncLocalStorage run context guarded against).
 */
export interface RunContext {
	/** Aborts on the caller's signal, the run timeout, or the end of the run. */
	readonly signal: AbortSignal;
	readonly readOnly: boolean;
	readonly snapshot: ComputerSessionSnapshot;
	readonly output: RunOutput;
	/** Artifacts written during the run; appended by `screenshot()`. */
	readonly screenshots: ComputerScreenshot[];
}

/** One engine request on behalf of the run, carrying the run signal. */
export type EngineCall = (method: EngineMethod, params: object) => Promise<unknown>;

/** Returns `promise` after arranging for user code awaiting it to resume once it settles. */
export type Resume = <T>(promise: Promise<T>) => Promise<T>;

/** What every facade method needs: the run it belongs to, its engine channel, and the vm resume hook. */
export interface RunScope {
	readonly context: RunContext;
	readonly call: EngineCall;
	readonly resume: Resume;
}

/** Tier table of one facade surface (`DESKTOP_METHODS`, `WINDOW_METHODS`, `ELEMENT_METHODS`). */
export type MethodTiers = Readonly<Record<string, ComputerCallPolicy>>;

/**
 * Admits one facade call: refuses `exec` methods in a read-only run and anything after the run
 * ended. A method missing from `tiers` counts as `exec`, so a new helper fails closed.
 */
export function guardRun(context: RunContext, tiers: MethodTiers, method: string): void {
	const tier = Object.hasOwn(tiers, method) ? tiers[method] : "exec";
	if (context.readOnly && tier === "exec") {
		throw new ComputerRunError("readOnly", `read-only run: '${method}' requires read_only: false`);
	}
	context.signal.throwIfAborted();
}

/** Runs one facade method of a surface: guarded, never throwing synchronously, and resuming the vm. */
export type FacadeMethod = <T>(method: string, work: (scope: RunScope) => Promise<T> | T) => Promise<T>;

/**
 * The single entry of every facade method on one surface (`tiers`). Even a guard refusal or a bad
 * argument settles the returned promise, and that promise resumes the vm, so user code awaiting it
 * always continues.
 */
export function facadeMethod(scope: RunScope, tiers: MethodTiers): FacadeMethod {
	return (method, work) =>
		scope.resume(
			Promise.resolve().then(() => {
				guardRun(scope.context, tiers, method);
				return work(scope);
			}),
		);
}
