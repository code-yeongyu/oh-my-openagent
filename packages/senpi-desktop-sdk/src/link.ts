import type {
	EngineMethod,
	EngineNotification,
	EngineNotificationParams,
	JsonRpcNotification,
	RpcPort,
} from "@oh-my-opencode/senpi-desktop-protocol";
import { ComputerError, fromPortFailure, malformed } from "./errors";
import { legacyReport, withVerdict } from "./report";
import type { ActionReport, VerifyAfter } from "./types";
import { parseActionReport, type Parser, type Tier } from "./validate";
import { verify } from "./verify";

type Listener<N extends EngineNotification> = (params: EngineNotificationParams[N]) => void;

/**
 * One SDK connection over an `RpcPort`: every facade call goes through `read` or `act`, which map failures to
 * `ComputerError` and validate replies at the boundary.
 */
export class Link {
	readonly #port: RpcPort;
	readonly #unsubscribe: () => void;
	readonly #listeners = new Map<EngineNotification, Set<(params: unknown) => void>>();
	readonly #parsers: Readonly<Partial<Record<EngineNotification, Parser<unknown>>>>;
	#closed = false;

	constructor(port: RpcPort, parsers: Readonly<Partial<Record<EngineNotification, Parser<unknown>>>>) {
		this.#port = port;
		this.#parsers = parsers;
		this.#unsubscribe = port.notifications.subscribe((notification) => this.#dispatch(notification));
	}

	/** A READ call whose reply must pass `parse`. */
	async read<T>(method: EngineMethod, params: unknown, parse: Parser<T>): Promise<T> {
		const value = await this.#call(method, params, "read");
		const parsed = parse(value);
		if (parsed === undefined) throw malformed(method, "read", value);
		return parsed;
	}

	/** An exec whose reply is `null` (legacy) or an `ActionReport`; `verify` then reads the effect back. */
	async act(method: EngineMethod, params: unknown, verifyAfter?: VerifyAfter): Promise<ActionReport> {
		return this.verifyAfter(this.report(method, await this.#call(method, params, "exec")), verifyAfter);
	}

	/** An exec reply member that must be `null` (legacy) or an `ActionReport`. */
	report(method: EngineMethod, value: unknown): ActionReport {
		if (value === null || value === undefined) return legacyReport();
		const report = parseActionReport(value);
		if (report === undefined) throw malformed(method, "exec", value);
		return report;
	}

	async verifyAfter<R extends ActionReport>(report: R, verifyAfter: VerifyAfter | undefined): Promise<R> {
		if (verifyAfter === undefined) return report;
		const verdict = await verify(this, verifyAfter.expectation, { timeoutMs: verifyAfter.timeoutMs });
		return withVerdict(report, verdict);
	}

	/** A raw exec reply, for callers whose reply wraps the report (`ax.typeText`). */
	exec(method: EngineMethod, params: unknown): Promise<unknown> {
		return this.#call(method, params, "exec");
	}

	on<N extends EngineNotification>(method: N, listener: Listener<N>): () => void {
		const set = this.#listeners.get(method) ?? new Set();
		this.#listeners.set(method, set);
		const entry = listener as (params: unknown) => void;
		set.add(entry);
		return () => {
			set.delete(entry);
		};
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#unsubscribe();
		this.#listeners.clear();
	}

	async #call(method: EngineMethod, params: unknown, tier: Tier): Promise<unknown> {
		if (this.#closed) {
			throw new ComputerError("Closed", `${method}: this SDK connection is closed`, {
				disposition: { delivery: "not_delivered", retry: "safe" },
				reason: "sdk_closed",
			});
		}
		try {
			return await this.#port.call(method, params);
		} catch (failure) {
			throw fromPortFailure(method, tier, failure);
		}
	}

	#dispatch(notification: JsonRpcNotification): void {
		const set = this.#listeners.get(notification.method);
		if (set === undefined || set.size === 0) return;
		const parse = this.#parsers[notification.method];
		const params = parse === undefined ? notification.params : parse(notification.params);
		if (params === undefined) return;
		for (const listener of [...set]) {
			try {
				listener(params);
			} catch (error) {
				// A listener's own failure must not stop delivery to the others; it is re-raised, never swallowed.
				queueMicrotask(() => {
					throw error;
				});
			}
		}
	}
}
