import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";

import { disposeDefaultLspManager, getLspManager } from "@oh-my-opencode/lsp-core/lsp/manager";

import { unlinkQuietly } from "./lock.js";
import type { DaemonPaths } from "./paths.js";
import { handleDaemonMessage } from "./request-routing.js";
import { createLineDecoder, encodeJsonLine } from "./socket-jsonrpc.js";

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

	mkdirSync(paths.dir, { recursive: true });
	unlinkQuietly(paths.socket);

	const connections = new Set<Socket>();
	let lastActiveAt = Date.now();
	const touch = (): void => {
		lastActiveAt = Date.now();
	};

	const server = createServer((socket) => {
		connections.add(socket);
		touch();
		const decoder = createLineDecoder((message) => {
			touch();
			void respond(socket, message);
		});
		socket.on("data", (chunk) => decoder.push(chunk));
		socket.on("error", () => socket.destroy());
		socket.on("close", () => {
			connections.delete(socket);
			touch();
		});
	});
	server.on("error", (error) => logServerError(error));

	const endpointPath = join(paths.dir, "daemon.endpoint");
	await listen(server, paths.socket);
	writeFileSync(paths.pid, `${process.pid}\n`);
	writeFileSync(endpointPath, paths.socket);

	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		clearInterval(idleTimer);
		for (const socket of connections) socket.destroy();
		connections.clear();
		await closeServer(server);
		unlinkQuietly(paths.socket);
		unlinkQuietly(paths.pid);
		unlinkQuietly(endpointPath);
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

async function respond(socket: Socket, message: unknown): Promise<void> {
	try {
		const response = await handleDaemonMessage(message);
		if (response && socket.writable) socket.write(encodeJsonLine(response));
	} catch (error) {
		logServerError(error);
	}
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
