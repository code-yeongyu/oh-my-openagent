import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { connect } from "node:net";
import { dirname } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { type LockHandle, tryAcquireLock, unlinkQuietly } from "./lock.js";
import type { DaemonPaths } from "./paths.js";

const PROBE_TIMEOUT_MS = 500;
const DEFAULT_READY_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

export class DaemonUnreachableError extends Error {
	constructor(socketPath: string) {
		super(`LSP daemon did not become reachable at ${socketPath}`);
		this.name = "DaemonUnreachableError";
	}
}

export interface EnsureDaemonDeps {
	probe(socketPath: string): Promise<boolean>;
	acquireLock(lockPath: string): LockHandle | null;
	cleanupStaleSocket(socketPath: string): void;
	spawnDaemon(paths: DaemonPaths): void;
	sleep(ms: number): Promise<void>;
	now(): number;
}

export interface EnsureDaemonOptions {
	readyTimeoutMs?: number;
	pollIntervalMs?: number;
}

export async function ensureDaemonRunning(
	paths: DaemonPaths,
	deps: EnsureDaemonDeps = defaultEnsureDaemonDeps(),
	options: EnsureDaemonOptions = {},
): Promise<void> {
	const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

	if (await deps.probe(paths.socket)) return;

	const lock = deps.acquireLock(paths.lock);
	if (!lock) {
		await waitUntilReachable(paths.socket, deps, readyTimeoutMs, pollIntervalMs);
		return;
	}

	try {
		if (await deps.probe(paths.socket)) return;
		deps.cleanupStaleSocket(paths.socket);
		deps.spawnDaemon(paths);
		await waitUntilReachable(paths.socket, deps, readyTimeoutMs, pollIntervalMs);
	} finally {
		lock.release();
	}
}

async function waitUntilReachable(
	socketPath: string,
	deps: EnsureDaemonDeps,
	readyTimeoutMs: number,
	pollIntervalMs: number,
): Promise<void> {
	const deadline = deps.now() + readyTimeoutMs;
	for (;;) {
		if (await deps.probe(socketPath)) return;
		if (deps.now() >= deadline) throw new DaemonUnreachableError(socketPath);
		await deps.sleep(pollIntervalMs);
	}
}

export function probeSocket(socketPath: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect(socketPath);
		const finish = (ok: boolean): void => {
			socket.destroy();
			resolve(ok);
		};
		const timer = setTimeout(() => finish(false), timeoutMs);
		timer.unref?.();
		socket.once("connect", () => {
			clearTimeout(timer);
			finish(true);
		});
		socket.once("error", () => {
			clearTimeout(timer);
			finish(false);
		});
	});
}

export function spawnDaemonProcess(paths: DaemonPaths): void {
	mkdirSync(dirname(paths.log), { recursive: true });
	const logFd = openSync(paths.log, "a");
	try {
		const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
		const child = spawn(execPath, [cliPath, "daemon"], {
			detached: true,
			stdio: ["ignore", logFd, logFd],
		});
		child.unref();
	} finally {
		closeSync(logFd);
	}
}

export function defaultEnsureDaemonDeps(): EnsureDaemonDeps {
	return {
		probe: (socketPath) => probeSocket(socketPath),
		acquireLock: (lockPath) => tryAcquireLock(lockPath),
		cleanupStaleSocket: (socketPath) => {
			if (existsSync(socketPath)) unlinkQuietly(socketPath);
		},
		spawnDaemon: (paths) => spawnDaemonProcess(paths),
		sleep: (ms) =>
			new Promise((resolve) => {
				const timer = setTimeout(resolve, ms);
				timer.unref?.();
			}),
		now: () => Date.now(),
	};
}
