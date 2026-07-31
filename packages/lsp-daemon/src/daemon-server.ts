import { chmodSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";

import { disposeDefaultLspManager, getLspManager } from "@oh-my-opencode/lsp-core/lsp/manager";
import { pingDaemon } from "./ensure-daemon.js";
import { setPrivateFileMode } from "./ipc-protocol.js";
import {
	acquireStartupLease,
	type DaemonOwner,
	DaemonStartupDeferredError,
	endpointIdentity,
	removeDaemonMetadataForOwner,
	writeDaemonOwner,
} from "./ownership.js";
import type { DaemonPaths } from "./paths.js";
import { handleDaemonMessage } from "./request-routing.js";
import { createLineDecoder, encodeJsonLine } from "./socket-jsonrpc.js";
import { reapStaleDaemonVersions } from "./version-reap.js";

export { DaemonAlreadyRunningError, DaemonStartupDeferredError } from "./ownership.js";

const DEFAULT_IDLE_SHUTDOWN_MS = 30 * 60_000;
const DEFAULT_IDLE_CHECK_INTERVAL_MS = 60_000;

export interface DaemonServerOptions {
	idleShutdownMs?: number;
	idleCheckIntervalMs?: number;
	onIdleShutdown?: () => void;
}

export interface DaemonServerHandle {
	readonly server: Server;
	close(): Promise<void>;
}

export async function startDaemonServer(
	paths: DaemonPaths,
	options: DaemonServerOptions = {},
): Promise<DaemonServerHandle> {
	const idleShutdownMs = options.idleShutdownMs ?? DEFAULT_IDLE_SHUTDOWN_MS;
	const idleCheckIntervalMs = options.idleCheckIntervalMs ?? DEFAULT_IDLE_CHECK_INTERVAL_MS;

	const lease = await acquireStartupLease(paths, (token) => pingDaemon(paths, token));

	const connections = new Set<Socket>();
	let lastActiveAt = Date.now();
	const touch = (): void => {
		lastActiveAt = Date.now();
	};

	let routeOwner = lease.owner;
	const server = createServer((socket) => {
		connections.add(socket);
		const activeRequests = new Map<string, AbortController>();
		touch();
		const decoder = createLineDecoder((message) => {
			touch();
			void respond(socket, message, lease.token, routeOwner, activeRequests);
		});
		socket.on("data", (chunk) => decoder.push(chunk));
		socket.on("error", () => socket.destroy());
		socket.on("close", () => {
			for (const controller of activeRequests.values()) controller.abort();
			activeRequests.clear();
			connections.delete(socket);
			touch();
		});
	});
	server.on("error", (error) => logServerError(error));

	let owner: DaemonOwner;
	try {
		await listen(server, paths.socket);
		if (process.platform !== "win32") chmodSync(paths.socket, 0o600);
		owner = { ...lease.owner, endpoint: endpointIdentity(paths.socket) };
		routeOwner = owner;
		writeDaemonOwner(paths, owner);
		await assertSelfProbe(paths, lease.token, owner);
	} catch (error) {
		lease.lock.release();
		throw error;
	}
	lease.lock.release();

	// Best-effort cross-version reap: the daemon now owns its version, so older
	// sibling versions may be reaped. Never block or crash startup on failure.
	void reapStaleDaemonVersions(paths).catch((error: unknown) => logServerError(error));

	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		clearInterval(idleTimer);
		for (const socket of connections) socket.destroy();
		connections.clear();
		await closeServer(server);
		removeDaemonMetadataForOwner(paths, owner);
		await disposeDefaultLspManager();
	};

	const idleTimer = setInterval(() => {
		if (connections.size > 0) return;
		if (getLspManager().clientCount() > 0) {
			touch();
			return;
		}
		if (Date.now() - lastActiveAt < idleShutdownMs) return;
		if (options.onIdleShutdown) {
			options.onIdleShutdown();
			return;
		}
		void close().then(() => process.exit(0));
	}, idleCheckIntervalMs);
	idleTimer.unref();

	installSignalHandlers(close);
	return { server, close };
}

async function respond(
	socket: Socket,
	message: unknown,
	token: string,
	owner: DaemonOwner,
	activeRequests: Map<string, AbortController>,
): Promise<void> {
	try {
		const response = await handleDaemonMessage(message, { token, owner, activeRequests });
		if (response && socket.writable) socket.write(encodeJsonLine(response));
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		logServerError(error);
	}
}

async function assertSelfProbe(paths: DaemonPaths, token: string, owner: DaemonOwner): Promise<void> {
	setPrivateFileMode(paths.pid);
	setPrivateFileMode(paths.endpoint);
	setPrivateFileMode(paths.owner);
	const ping = await pingDaemon(paths, token);
	if (!ping || ping.nonce !== owner.nonce) throw new DaemonStartupDeferredError("self_probe_failed");
}

function listen(server: Server, socketPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: unknown): void => reject(error);
		server.once("error", onError);
		server.listen(socketPath, () => {
			server.removeListener("error", onError);
			resolve();
		});
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()));
}

function installSignalHandlers(close: () => Promise<void>): void {
	const handler = (): void => {
		void close().then(() => process.exit(0));
	};
	process.once("SIGTERM", handler);
	process.once("SIGINT", handler);
}

function logServerError(error: unknown): void {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`[lsp-daemon] ${message}\n`);
}
