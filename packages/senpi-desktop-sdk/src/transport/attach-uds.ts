import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
	type EngineMethod,
	type JsonRpcErrorData,
	type JsonRpcNotification,
	type RpcCallOptions,
	type RpcNotificationListener,
	type RpcPort,
	type RpcPortFailure,
	STANDARD_RPC_ERRORS,
} from "@oh-my-opencode/senpi-desktop-protocol";
import { ComputerError, refusal } from "../errors";

/**
 * Engine methods an attach client never sends: the daemon owns its session, grant and stop paths, as the
 * `--oneshot` / `--mcp` bridge does (`oneshot.rs`). Pinned against `engine.schema.json` by the attach test.
 */
export const BRIDGE_REFUSED_METHODS: Readonly<Record<string, "hostOnly" | "testOnly">> = {
	"session.open": "hostOnly",
	"session.close": "hostOnly",
	"control.grant": "hostOnly",
	"control.revoke": "hostOnly",
	"stopPath.start": "hostOnly",
	"stopPath.heartbeat": "hostOnly",
	"stopPath.resume": "hostOnly",
	"$/test.advanceClock": "testOnly",
};

/** What the attach client reads from its process; only tests pass other values. */
export interface AttachEnvironment {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly platform: NodeJS.Platform;
	euid(): number;
	/**
	 * The uid serving the connected socket, read before any byte is written. JavaScript has no `SO_PEERCRED` /
	 * `getpeereid`, so the default reads the owner of the socket inode inside the pinned, checked directory.
	 */
	serverUid(socketPath: string): number;
}

export const processEnvironment: AttachEnvironment = {
	env: process.env,
	platform: process.platform,
	euid: () => process.geteuid?.() ?? -1,
	serverUid: (socketPath) => {
		const stat = fs.lstatSync(socketPath);
		if (!stat.isSocket()) throw new Error(`${socketPath} is not a socket`);
		return stat.uid;
	},
};

const refused = (message: string, reason: string) => refusal("Closed", message, reason);

/** The endpoint's parent, opened `O_DIRECTORY|O_NOFOLLOW` and checked through its fd (#12229 B1, T25-13). */
function openChecked(endpoint: string, environment: AttachEnvironment): { readonly fd: number; readonly entry: string } {
	const parent = path.dirname(endpoint);
	const name = path.basename(endpoint);
	let fd: number;
	try {
		fd = fs.openSync(parent, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
	} catch (error) {
		throw refused(`${parent}: cannot open the endpoint directory: ${String(error)}`, "endpoint_refused");
	}
	try {
		const me = environment.euid();
		const stat = fs.fstatSync(fd);
		if (stat.uid !== me) throw refused(`${parent} is owned by uid ${stat.uid}, not ${me}`, "endpoint_refused");
		if ((stat.mode & 0o077) !== 0) {
			const mode = (stat.mode & 0o7777).toString(8);
			throw refused(`${parent} has mode ${mode}; it must not be accessible to group or other`, "endpoint_refused");
		}
		// Linux reaches entries through the directory fd; macOS has no fd-relative connect, so the path is used.
		const base = environment.platform === "linux" ? `/proc/self/fd/${fd}` : parent;
		const grandparent = fs.statSync(path.join(base, ".."));
		const sticky = (grandparent.mode & 0o1000) !== 0;
		if (grandparent.uid !== me && grandparent.uid !== 0) {
			throw refused(`${parent}/.. is owned by uid ${grandparent.uid}`, "endpoint_refused");
		}
		if ((grandparent.mode & 0o022) !== 0 && !sticky) {
			throw refused(`${parent}/.. is writable by group or other and not sticky`, "endpoint_refused");
		}
		return { fd, entry: path.join(base, name) };
	} catch (error) {
		fs.closeSync(fd);
		throw error;
	}
}

function connectSocket(socketPath: string): Promise<net.Socket> {
	const { promise, resolve, reject } = Promise.withResolvers<net.Socket>();
	const socket = net.createConnection({ path: socketPath });
	socket.once("connect", () => {
		socket.off("error", reject);
		resolve(socket);
	});
	socket.once("error", reject);
	return promise;
}

class PortError extends Error implements RpcPortFailure {
	readonly rpcCode?: number;
	readonly data?: JsonRpcErrorData | null;
	readonly code?: RpcPortFailure["code"];
	readonly nothingSent?: boolean;

	constructor(failure: RpcPortFailure) {
		super(failure.message);
		this.name = "AttachPortFailure";
		this.rpcCode = failure.rpcCode;
		this.data = failure.data;
		this.code = failure.code;
		this.nothingSent = failure.nothingSent;
	}
}

interface Waiter {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: PortError) => void;
	readonly cleanup: () => void;
}

/**
 * Attaches to a running `--serve` daemon over its unix socket (NDJSON JSON-RPC 2.0): the daemon's one shared
 * session, its frames, refs and stop paths. Refuses inside a host-created kernel (`SENPI_DESKTOP_HOST=1`, an
 * accident guard), refuses an endpoint directory or server that fails the rule, and never sends a host-only method.
 */
export async function attachUds(endpoint: string, environment: AttachEnvironment = processEnvironment): Promise<RpcPort> {
	if (environment.env.SENPI_DESKTOP_HOST === "1") {
		throw refusal(
			"ControlRequired",
			"attach is not available inside a host session; use the host's computer tool",
			"attach_inside_session",
		);
	}
	if (environment.platform === "win32") {
		throw refusal("InvalidTarget", "attach over a Windows named pipe is not available", "unsupported_transport");
	}
	const dir = openChecked(endpoint, environment);
	let socket: net.Socket;
	try {
		socket = await connectSocket(dir.entry);
		const me = environment.euid();
		let server: number;
		try {
			server = environment.serverUid(dir.entry);
		} catch (error) {
			socket.destroy();
			throw refused(`${endpoint}: the server's uid is unavailable: ${String(error)}`, "server_refused");
		}
		if (server !== me) {
			socket.destroy();
			throw refused(`${endpoint} is served by uid ${server}, not ${me}`, "server_refused");
		}
	} catch (error) {
		if (error instanceof ComputerError) throw error;
		throw refused(`${endpoint}: cannot connect: ${String(error)}`, "unreachable");
	} finally {
		fs.closeSync(dir.fd);
	}
	return new AttachedPort(socket);
}

class AttachedPort implements RpcPort {
	readonly #socket: net.Socket;
	readonly #pending = new Map<number, Waiter>();
	readonly #listeners = new Set<RpcNotificationListener>();
	readonly #closed: Promise<void>;
	#nextId = 1;
	#buffer = "";
	#ended = false;
	/** An error the daemon answered with a null id (it could not read which request failed); it closes next. */
	#unmatched: RpcPortFailure | undefined;

	constructor(socket: net.Socket) {
		this.#socket = socket;
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => this.#receive(chunk));
		let failure = "";
		socket.on("error", (error) => {
			failure = `: ${error.message}`;
		});
		this.#closed = new Promise((resolve) => {
			socket.once("close", () => {
				this.#ended = true;
				const closed = new PortError(
					this.#unmatched ?? { message: `the desktop daemon connection closed${failure}`, code: "Closed" },
				);
				for (const waiter of this.#pending.values()) {
					waiter.cleanup();
					waiter.reject(closed);
				}
				this.#pending.clear();
				resolve();
			});
		});
	}

	readonly notifications = {
		subscribe: (listener: RpcNotificationListener): (() => void) => {
			this.#listeners.add(listener);
			return () => {
				this.#listeners.delete(listener);
			};
		},
	};

	call(method: EngineMethod, params: unknown, options: RpcCallOptions = {}): Promise<unknown> {
		const rejection = BRIDGE_REFUSED_METHODS[method];
		if (rejection !== undefined) {
			return Promise.reject(
				new PortError({
					message: `${method} is not available over attach`,
					rpcCode: STANDARD_RPC_ERRORS.methodNotFound,
					data: { reason: rejection },
					nothingSent: true,
				}),
			);
		}
		if (this.#ended) {
			return Promise.reject(new PortError({ message: `${method}: the connection is closed`, code: "Closed", nothingSent: true }));
		}
		const id = this.#nextId++;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const cancel = () => this.#write({ jsonrpc: "2.0", method: "$/cancel", params: { id } });
		const timer = options.timeoutMs === undefined ? undefined : setTimeout(cancel, options.timeoutMs);
		options.signal?.addEventListener("abort", cancel, { once: true });
		const cleanup = () => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", cancel);
		};
		this.#pending.set(id, { resolve, reject, cleanup });
		this.#write({ jsonrpc: "2.0", id, method, params });
		return promise;
	}

	async close(): Promise<void> {
		this.#socket.end();
		await this.#closed;
	}

	#write(message: unknown): void {
		this.#socket.write(`${JSON.stringify(message)}\n`);
	}

	#receive(chunk: string): void {
		this.#buffer += chunk;
		let newline = this.#buffer.indexOf("\n");
		while (newline >= 0) {
			const line = this.#buffer.slice(0, newline).trim();
			this.#buffer = this.#buffer.slice(newline + 1);
			if (line.length > 0) this.#message(line);
			newline = this.#buffer.indexOf("\n");
		}
	}

	#message(line: string): void {
		let message: {
			readonly id?: unknown;
			readonly method?: unknown;
			readonly result?: unknown;
			readonly error?: { readonly code: number; readonly message: string; readonly data?: JsonRpcErrorData | null };
		};
		try {
			message = JSON.parse(line);
		} catch {
			this.#socket.destroy(new Error(`the desktop daemon sent a line that is not JSON: ${line.slice(0, 200)}`));
			return;
		}
		if (typeof message.method === "string" && message.id === undefined) {
			for (const listener of [...this.#listeners]) listener(message as JsonRpcNotification);
			return;
		}
		if (message.id === null && message.error !== undefined) {
			const { error } = message;
			this.#unmatched = { message: error.message, rpcCode: error.code, data: error.data ?? null };
			return;
		}
		if (typeof message.id !== "number") return;
		const waiter = this.#pending.get(message.id);
		if (waiter === undefined) return;
		this.#pending.delete(message.id);
		waiter.cleanup();
		if (message.error === undefined) {
			waiter.resolve(message.result);
			return;
		}
		const { error } = message;
		waiter.reject(new PortError({ message: error.message, rpcCode: error.code, data: error.data ?? null }));
	}
}
