import { randomUUID } from "node:crypto";
import type { EngineMethod } from "@oh-my-opencode/senpi-desktop-protocol";
import type { ControlGrants } from "./control-grants";
import { type CallOptions, DesktopEngineRpcError, DesktopServiceError } from "./rpc-client";
import type { Connection } from "./session-state";
import { REVOKE_TIMEOUT_MS } from "./timeouts";

/** Pointer and keyboard methods; on the desktop or a display target every backend posts them globally (#10788). */
const GLOBAL_INPUT_METHODS: ReadonlySet<EngineMethod> = new Set<EngineMethod>([
	"click",
	"moveMouse",
	"drag",
	"scroll",
	"typeText",
	"keyChord",
	"holdKeys",
	"holdMouse",
]);

export const FULL_ACCESS_GRANT_REASON = "full access: the session's permission preset consents to desktop input";

/** The engine's `Target::parse`: `desktop` compared ASCII case-insensitively, `display:` as an exact prefix. */
function isGlobalTarget(target: string): boolean {
	return target.replace(/[A-Z]/g, (letter) => letter.toLowerCase()) === "desktop" || target.startsWith("display:");
}

/** True for input the engine admits only with the control grant whatever delivery was asked for. */
export function isGlobalInput(method: EngineMethod, params: unknown): boolean {
	if (!GLOBAL_INPUT_METHODS.has(method) || typeof params !== "object" || params === null) return false;
	const target: unknown = Reflect.get(params, "target");
	return typeof target === "string" && isGlobalTarget(target);
}

function isControlRequired(error: unknown): boolean {
	return (
		error instanceof DesktopEngineRpcError &&
		error.data !== null &&
		"code" in error.data &&
		error.data.code === "ControlRequired"
	);
}

function throwIfCancelled(method: EngineMethod, options: CallOptions): void {
	if (options.signal?.aborted === true) throw new DesktopServiceError("Cancelled", `${method} was cancelled`);
}

/**
 * Full access is the consent for desktop input (#10022): there the service takes the control grant itself,
 * without a confirm and headless included, and a grant only full access authorized is revoked as soon as the
 * session leaves full access. Outside full access the service adds nothing: the engine's admission gate is the
 * single, audited refusal (#10788).
 */
export class FullAccessConsent {
	readonly #grants: ControlGrants;
	readonly #fullAccess: () => boolean;

	constructor(grants: ControlGrants, fullAccess: () => boolean) {
		this.#grants = grants;
		this.#fullAccess = fullAccess;
	}

	/** Revokes a full-access grant once the session is no longer in full access; a failed revoke fails the call. */
	async fence(connection: Connection): Promise<void> {
		if (!this.#grants.automaticLive || this.#fullAccess()) return;
		await this.#revoke(connection);
	}

	/**
	 * Sends global input. In full access it grants first when no grant may be live, and retries exactly once when
	 * the engine refused `ControlRequired` at admission (before any input), as after a stop the user resumed.
	 * `Suspended`, cancellation, and every other failure are never retried, and resume is never sent.
	 *
	 * The consent read and the send are one step: every await (a revoke, a grant) loops back to read full access
	 * again, and the request is written in the same synchronous turn as the read that admitted it.
	 */
	async send(connection: Connection, method: EngineMethod, params: unknown, options: CallOptions): Promise<unknown> {
		let retried = false;
		for (;;) {
			throwIfCancelled(method, options);
			const fullAccess = this.#fullAccess();
			if (!fullAccess && this.#grants.automaticLive) {
				await this.#revoke(connection);
				continue;
			}
			if (fullAccess && !this.#grants.possiblyLive) {
				await this.#grant(connection, options);
				continue;
			}
			try {
				return await connection.rpc.request(method, params, options);
			} catch (error) {
				if (!fullAccess || retried || !isControlRequired(error) || options.signal?.aborted === true) throw error;
			}
			retried = true;
			await this.#grant(connection, options);
		}
	}

	#revoke(connection: Connection): Promise<unknown> {
		return this.#grants.revoke(() => connection.rpc.request("control.revoke", {}, { timeoutMs: REVOKE_TIMEOUT_MS }));
	}

	async #grant(connection: Connection, options: CallOptions): Promise<void> {
		const params = { reason: FULL_ACCESS_GRANT_REASON, confirmationId: randomUUID() };
		const signal = options.signal;
		await this.#grants.grant(
			() => connection.rpc.request("control.grant", params, signal === undefined ? {} : { signal }),
			false,
			true,
		);
	}
}
