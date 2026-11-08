import { ComputerRunError } from "./context";

/** Headroom below the run budget so a predicate deadline fails with its own message first. */
const RUN_BUDGET_SLACK_MS = 1_000;
const DEFAULT_PREDICATE_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 100;
const MIN_INTERVAL_MS = 10;

export interface WaitOptions {
	/** Max time to poll a predicate, in ms (default 30 s, clamped below the run budget). */
	readonly timeout?: number;
	/** Poll interval in ms (default 100, floor 10). */
	readonly interval?: number;
}

/** The effective predicate deadline: strictly below the run budget, `0`/`Infinity` meaning "the whole budget". */
function predicateTimeout(runTimeoutMs: number, explicit: number | undefined): number {
	const budget = Math.max(1, runTimeoutMs - RUN_BUDGET_SLACK_MS);
	if (explicit === 0 || explicit === Number.POSITIVE_INFINITY) return budget;
	if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) return Math.min(explicit, budget);
	return Math.min(DEFAULT_PREDICATE_TIMEOUT_MS, budget);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const onAbort = () => {
		clearTimeout(timer);
		reject(signal.reason);
	};
	const timer = setTimeout(() => {
		signal.removeEventListener("abort", onAbort);
		resolve();
	}, ms);
	signal.addEventListener("abort", onAbort, { once: true });
	return promise;
}

async function poll(
	predicate: () => unknown,
	signal: AbortSignal,
	timeout: number,
	interval: number,
): Promise<unknown> {
	const deadline = new AbortController();
	const timer = setTimeout(() => deadline.abort(), timeout);
	try {
		for (;;) {
			const value = await predicate();
			signal.throwIfAborted();
			if (value) return value;
			if (deadline.signal.aborted) {
				throw new ComputerRunError(
					"wait",
					`wait(predicate) timed out after ${timeout} ms; the predicate never returned truthy`,
				);
			}
			await sleep(interval, signal);
		}
	} finally {
		clearTimeout(timer);
	}
}

/** The run-scoped `wait(ms)` / `wait(predicate, {timeout, interval})` global, cancelled with the run. */
export function createWait(
	signal: AbortSignal,
	runTimeoutMs: number,
): (msOrPredicate: unknown, options?: WaitOptions) => Promise<unknown> {
	return async (msOrPredicate, options = {}) => {
		if (typeof msOrPredicate === "number") return sleep(msOrPredicate, signal);
		if (typeof msOrPredicate !== "function") {
			throw new ComputerRunError("wait", "wait(...) expects milliseconds or a predicate function to poll");
		}
		const interval = Math.max(options.interval ?? DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
		return poll(() => msOrPredicate(), signal, predicateTimeout(runTimeoutMs, options.timeout), interval);
	};
}
