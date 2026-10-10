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

/** `session.open` params, forwarded verbatim; every policy they configure is enforced by the engine. */
export interface DesktopSessionOpenParams {
	readonly display?: string | null;
	readonly macosCanary?: "session" | "off";
	readonly allowHostRelayOnlyStop?: boolean;
	readonly auditPath?: string | null;
	readonly artifactDir?: string | null;
	readonly screenshotGc?: { readonly staleMs?: number; readonly scanIntervalMs?: number };
	readonly captureCaps?: {
		readonly maxWidth?: number | null;
		readonly maxHeight?: number | null;
		readonly coordinateSafe?: boolean;
		readonly maxBytes?: number;
	};
}

export interface DesktopServiceOptions {
	readonly createChild?: ChildFactory;
}

/** One live engine child. Mutable: the resume token, armed chord, and heartbeat belong to this child only. */
interface Connection {
	readonly rpc: RpcClient;
	resumeToken: string;
	armedChord: string | undefined;
	heartbeat: NodeJS.Timeout | undefined;
}

/** What the host asked for; replayed onto a fresh child after a crash or grace kill. */
interface DesiredSession {
	readonly params: DesktopSessionOpenParams;
	chord: string | undefined;
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

	onError(listener: Listener<Error>): Unsubscribe {
		return this.#hub.onError(listener);
	}

	/** Starts the engine when none runs, then opens (or reconfigures) the desktop session. */
	open(params: DesktopSessionOpenParams): Promise<DesktopCapabilities> {
		return this.#serialize(async () => {
			this.#desired = { params, chord: this.#desired?.chord };
			const live = this.#connection;
			if (live?.rpc.alive === true) return this.#openSession(live, params);
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
		return connection.rpc.request(method, params, options);
	}

	/**
	 * `control.revoke`, best effort (#9651 B5b): with no live engine it is a no-op, the call is
	 * bounded by `REVOKE_TIMEOUT_MS`, and a failure is logged through the error hub rather than
	 * thrown — `session.close` stays the backstop that always releases the grant.
	 */
	async revokeControl(): Promise<void> {
		const connection = this.#connection;
		if (connection === undefined || !connection.rpc.alive) return;
		try {
			await connection.rpc.request("control.revoke", {}, { timeoutMs: REVOKE_TIMEOUT_MS });
		} catch (error) {
			if (error instanceof DesktopServiceError || error instanceof DesktopEngineRpcError) {
				this.#hub.emitError(error);
				return;
			}
			throw error;
		}
	}

	async capabilities(): Promise<DesktopCapabilities> {
		const result = await this.call("capabilities", {}, { timeoutMs: CAPABILITIES_TIMEOUT_MS });
		if (!isDesktopCapabilities(result)) throw malformed("capabilities");
		return result;
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

function deadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new DesktopServiceError("Timeout", message)), ms);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
