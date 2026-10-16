import { DesktopEngineAbiMismatchError } from "@oh-my-opencode/senpi-desktop-engine";
import {
	type AuditEvent,
	type DesktopCapabilities,
	ENGINE_ABI,
	type EngineMethod,
	PROTOCOL_VERSION,
	type StopPathStatus,
} from "@oh-my-opencode/senpi-desktop-protocol";
import { type ChildFactory, engineChildFactory } from "./child";
import { ControlGrants } from "./control-grants";
import { deadline } from "./deadline";
import { type Listener, NotificationHub, type Unsubscribe } from "./notifications";
import { isDesktopCapabilities, isStopPathStatus, parseHello, parseSessionOpened } from "./parse";
import { type CallOptions, DesktopEngineRpcError, DesktopServiceError, RpcClient } from "./rpc-client";
import {
	CAPABILITIES_TIMEOUT_MS,
	CLOSE_TIMEOUT_MS,
	HEARTBEAT_MS,
	REVOKE_TIMEOUT_MS,
	START_TIMEOUT_MESSAGE,
	START_TIMEOUT_MS,
} from "./timeouts";
import type { Connection, DesiredSession, DesktopSessionOpenParams } from "./session-state";

export interface DesktopServiceOptions {
	readonly createChild?: ChildFactory;
}

/**
 * JSON-RPC client over one lazy engine child per agent session. `open`/`close` (and the lazy restart)
 * are serialized; calls run concurrently because the engine serializes mutations itself.
 */
export class DesktopService {
	readonly #createChild: ChildFactory;
	readonly #hub = new NotificationHub();
	#lifecycle: Promise<unknown> = Promise.resolve();
	#connection: Connection | undefined;
	#desired: DesiredSession | undefined;
	#lastStopPath: StopPathStatus | undefined;
	readonly #grants = new ControlGrants();

	constructor(options: DesktopServiceOptions = {}) {
		this.#createChild = options.createChild ?? engineChildFactory();
		this.#hub.onStopPathChange((status) => {
			this.#lastStopPath = status;
		});
	}

	onAudit(listener: Listener<AuditEvent>): Unsubscribe {
		return this.#hub.onAudit(listener);
	}

	onStopPathChange(listener: Listener<StopPathStatus>): Unsubscribe {
		return this.#hub.onStopPathChange(listener);
	}

	/**
	 * Failures no caller awaits: a malformed notification, a failed heartbeat or best-effort revoke, and
	 * anything passed to `reportError`. A host must subscribe, or these are lost.
	 */
	onError(listener: Listener<Error>): Unsubscribe {
		return this.#hub.onError(listener);
	}

	/** Starts the engine when none runs, then opens (or reconfigures) the desktop session. */
	open(params: DesktopSessionOpenParams): Promise<DesktopCapabilities> {
		return this.#serialize(async () => {
			const normalized = { ...params, showCursor: params.showCursor ?? true };
			this.#desired = { params: normalized, chord: this.#desired?.chord };
			const live = this.#connection;
			if (live?.rpc.alive === true) return this.#openSession(live, normalized);
			if (live !== undefined) this.#drop(live);
			return (await this.#start(this.#desired)).capabilities;
		});
	}

	/** Arms the stop path for `chord`; repeating the same chord only reads the status. */
	ensureStopPath(chord: string): Promise<StopPathStatus> {
		return this.#serialize(async () => {
			const connection = await this.#liveLocked();
			if (connection.armedChord === chord) return this.#stopPath(connection, "stopPath.status", {});
			const status = await this.#stopPath(connection, "stopPath.start", { chord });
			connection.armedChord = chord;
			if (this.#desired !== undefined) this.#desired.chord = chord;
			return status;
		});
	}

	async call(method: EngineMethod, params: unknown, options: CallOptions = {}): Promise<unknown> {
		const connection = await this.#live();
		const request = () => connection.rpc.request(method, params, options);
		if (method === "control.grant") return this.#grants.grant(request, options.signal?.aborted === true);
		if (method === "control.revoke") return this.#grants.revoke(request);
		return request();
	}

	/** Reports a failure nobody awaits (a best-effort revoke) to `onError` listeners instead of dropping it. */
	reportError(error: unknown): void {
		this.#hub.emitError(error instanceof Error ? error : new Error(String(error)));
	}

	/**
	 * `control.revoke`, best effort (#9651 B5b), sent only while a grant this service asked for may be
	 * live (one sent and not yet covered by a revoke that succeeded), so a run or turn end without one
	 * adds nothing to the engine's audit, and a revoke that failed or was dropped is sent again later. The request is written
	 * before this returns, so it reaches the engine's serial queue ahead of anything sent afterwards;
	 * callers need not wait for the reply. A failure is reported through the error hub, and
	 * `session.close` stays the backstop that always releases the grant.
	 */
	revokeControl(): Promise<void> {
		const connection = this.#connection;
		if (connection === undefined || !connection.rpc.alive || !this.#grants.possiblyLive) return Promise.resolve();
		return this.#grants.revoke(() => connection.rpc.request("control.revoke", {}, { timeoutMs: REVOKE_TIMEOUT_MS })).then(
			() => undefined,
			(error: unknown) => {
				if (error instanceof DesktopServiceError || error instanceof DesktopEngineRpcError) {
					this.#hub.emitError(error);
					return;
				}
				throw error;
			},
		);
	}

	async capabilities(): Promise<DesktopCapabilities> {
		const result = await this.call("capabilities", {}, { timeoutMs: CAPABILITIES_TIMEOUT_MS });
		if (!isDesktopCapabilities(result)) throw malformed("capabilities");
		return { ...result, cursorOverlay: result.cursorOverlay ?? false };
	}

	/** Reads the live stop-path state; it never arms or latches anything. */
	async stopPathStatus(): Promise<StopPathStatus> {
		return this.#stopPath(await this.#live(), "stopPath.status", {});
	}

	async stop(): Promise<StopPathStatus> {
		return this.#stopPath(await this.#live(), "stopPath.stop", { source: "host-relay" });
	}

	async resume(): Promise<StopPathStatus> {
		const connection = await this.#live();
		return this.#stopPath(connection, "stopPath.resume", { token: connection.resumeToken });
	}

	/** Closes the session and lets the engine exit at EOF; kills it after `CLOSE_TIMEOUT_MS`. */
	close(): Promise<void> {
		return this.#serialize(async () => {
			this.#desired = undefined;
			const connection = this.#connection;
			if (connection === undefined) return;
			this.#drop(connection);
			// A crashed or killed engine has no session left to close.
			if (!connection.rpc.alive) return;
			const graceful = async () => {
				connection.rpc.cancelHolds();
				await connection.rpc.request("session.close", {});
				connection.rpc.end();
				await connection.rpc.exited;
			};
			try {
				await deadline(graceful(), CLOSE_TIMEOUT_MS, "Timed out closing desktop engine");
			} finally {
				connection.rpc.kill();
			}
		});
	}

	#serialize<T>(work: () => Promise<T>): Promise<T> {
		const run = this.#lifecycle.then(work);
		// The chain only orders lifecycle steps; each caller receives its own outcome through `run`.
		this.#lifecycle = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	#live(): Promise<Connection> {
		const live = this.#connection;
		return live?.rpc.alive === true ? Promise.resolve(live) : this.#serialize(() => this.#liveLocked());
	}

	/** The live connection, or a fresh child replaying the desired session; caller holds the lifecycle chain. */
	async #liveLocked(): Promise<Connection> {
		const current = this.#connection;
		if (current?.rpc.alive === true) return current;
		// A killed child whose `close` event has not arrived yet is already unusable.
		if (current !== undefined) this.#drop(current);
		if (this.#desired === undefined) throw new DesktopServiceError("Closed", "desktop session is not open");
		return (await this.#start(this.#desired)).connection;
	}

	async #start(desired: DesiredSession): Promise<{ connection: Connection; capabilities: DesktopCapabilities }> {
		const rpc: RpcClient = new RpcClient(await this.#createChild(), {
			onNotification: (method, params) => this.#hub.dispatch(method, params),
			onExit: () => {
				if (this.#connection?.rpc === rpc) this.#drop(this.#connection);
			},
		});
		const connection: Connection = { rpc, resumeToken: "", armedChord: undefined, heartbeat: undefined };
		try {
			const capabilities = await deadline(
				this.#handshake(connection, desired),
				START_TIMEOUT_MS,
				START_TIMEOUT_MESSAGE,
			);
			this.#connection = connection;
			connection.heartbeat = setInterval(() => this.#heartbeat(connection), HEARTBEAT_MS);
			return { connection, capabilities };
		} catch (error) {
			rpc.kill();
			throw error;
		}
	}

	/** `engine.hello` with the ABI check, `session.open`, then the stop path state the previous child had. */
	async #handshake(connection: Connection, desired: DesiredSession): Promise<DesktopCapabilities> {
		const hello = parseHello(await connection.rpc.request("engine.hello", {}));
		if (hello === undefined) throw malformed("engine.hello");
		if (hello.abi !== ENGINE_ABI || hello.protocolVersion !== PROTOCOL_VERSION) {
			throw new DesktopEngineAbiMismatchError(connection.rpc.enginePath, hello);
		}
		const capabilities = await this.#openSession(connection, desired.params);
		if (desired.chord !== undefined) {
			await this.#stopPath(connection, "stopPath.start", { chord: desired.chord });
			connection.armedChord = desired.chord;
		}
		if (this.#lastStopPath?.suspended === true) {
			// A restart must not lift the user's stop latch.
			await this.#stopPath(connection, "stopPath.stop", { source: "host-relay" });
		}
		return capabilities;
	}

	async #openSession(connection: Connection, params: DesktopSessionOpenParams): Promise<DesktopCapabilities> {
		const reply = await connection.rpc.request("session.open", params, { timeoutMs: START_TIMEOUT_MS });
		const opened = parseSessionOpened(reply);
		if (opened === undefined) throw malformed("session.open");
		// The token stays inside the service: only `resume()` sends it back.
		connection.resumeToken = opened.resumeToken;
		return opened.capabilities;
	}

	async #stopPath(connection: Connection, method: EngineMethod, params: object): Promise<StopPathStatus> {
		const status = await connection.rpc.request(method, params);
		if (!isStopPathStatus(status)) throw malformed(method);
		this.#lastStopPath = status;
		return status;
	}

	#heartbeat(connection: Connection): void {
		connection.rpc.request("stopPath.heartbeat", {}).catch((error: unknown) => {
			// `Closed` means the child is gone; its exit already dropped the connection.
			if (error instanceof DesktopServiceError && error.code === "Closed") return;
			if (error instanceof DesktopServiceError || error instanceof DesktopEngineRpcError) {
				this.#hub.emitError(error);
				return;
			}
			throw error;
		});
	}

	#drop(connection: Connection): void {
		clearInterval(connection.heartbeat);
		if (this.#connection === connection) this.#connection = undefined;
	}
}

function malformed(method: string): DesktopServiceError {
	return new DesktopServiceError("Internal", `desktop engine sent a malformed ${method} result`);
}
