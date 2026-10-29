import type { EscapeStopped } from "@oh-my-opencode/senpi-desktop-protocol";
import type { Listener, Unsubscribe } from "./notifications";
import { malformed } from "./malformed-result";
import { isEscapeStopped, isRecord } from "./parse";
import type { Connection } from "./session-state";
import { CAPABILITIES_TIMEOUT_MS } from "./timeouts";

/** Native counters restart with a child; the host's observed stop epoch never goes backwards. */
export class EscapeStops {
	#native = 0;
	#epoch = 0;
	readonly #listeners = new Set<Listener<EscapeStopped>>();
	readonly #stopped: () => void;

	constructor(stopped: () => void) {
		this.#stopped = stopped;
	}

	get count(): number {
		return this.#epoch;
	}

	listen(listener: Listener<EscapeStopped>): Unsubscribe {
		this.#listeners.add(listener);
		return () => { this.#listeners.delete(listener); };
	}

	resetNative(): void {
		this.#native = 0;
	}

	observe(stops: number): void {
		if (stops <= this.#native) return;
		this.#epoch += stops - this.#native;
		this.#native = stops;
		this.#stopped();
		for (const listener of this.#listeners) listener({ escapeStops: this.#epoch });
	}

	async refresh(connection: Connection | undefined): Promise<number> {
		if (connection?.rpc.alive === true) {
			const state = await connection.rpc.request("control.state", {}, { timeoutMs: CAPABILITIES_TIMEOUT_MS });
			if (isEscapeStopped(state)) this.observe(state.escapeStops);
			else if (isRecord(state) && "escapeStops" in state) {
				throw malformed("control.state");
			}
		}
		return this.#epoch;
	}
}
