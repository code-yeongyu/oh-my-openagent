import { DesktopEngineRpcError } from "./rpc-client";

/**
 * Which foreground-control grants this service asked for may still hold (#9651 B5b), so a revoke is
 * sent only while one may be live and a run or turn end without one adds nothing to the engine audit.
 */
export class ControlGrants {
	#sent = 0;
	/** Number of the newest grant that may still hold; a refused grant leaves it at the one before. */
	#possiblyLive = 0;
	/** How many sent grants a successful `control.revoke` has covered. */
	#revoked = 0;

	get possiblyLive(): boolean {
		return this.#possiblyLive > this.#revoked;
	}

	/**
	 * Sends `control.grant`, counted as possibly live from the moment it is written: a grant whose reply
	 * is lost to a cancel may still hold. A request cancelled before sending and an engine refusal
	 * (`InputBusy`, `Suspended`, any engine error) granted nothing, so they stay uncounted (#9967).
	 */
	async grant(request: () => Promise<unknown>, cancelled: boolean): Promise<unknown> {
		if (cancelled) return request();
		this.#sent += 1;
		const grant = this.#sent;
		const before = this.#possiblyLive;
		this.#possiblyLive = grant;
		try {
			return await request();
		} catch (error) {
			if (error instanceof DesktopEngineRpcError && this.#possiblyLive === grant) this.#possiblyLive = before;
			throw error;
		}
	}

	/**
	 * Sends `control.revoke`; `request` is called before this yields, so the revoke is written ahead of
	 * anything sent afterwards. One that succeeded covers every grant sent before it; one that failed or
	 * was dropped covers none, so it is sent again later.
	 */
	async revoke<T>(request: () => Promise<T>): Promise<T> {
		const covers = this.#sent;
		const result = await request();
		this.#revoked = Math.max(this.#revoked, covers);
		return result;
	}
}
