import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { Socket } from "node:net";
import { dirname } from "node:path";
import { execPath } from "node:process";

import { authEnvelope, readAuthToken } from "./ipc-protocol.js";
import type { OwnerPing } from "./ownership.js";
import { type DaemonPaths, packagedRuntimeDefaults } from "./paths.js";
import { type DaemonRuntimeDefaults, resolveDaemonRuntime } from "./runtime-contract.js";
import { createLineDecoder, encodeJsonLine } from "./socket-jsonrpc.js";

export { InvalidRuntimeOverrideError, OMO_LSP_DAEMON_CLI, resolveDaemonRuntime } from "./runtime-contract.js";

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
	probe(paths: DaemonPaths, signal?: AbortSignal): Promise<boolean>;
	spawnDaemon(paths: DaemonPaths): void;
	sleep(ms: number, signal?: AbortSignal): Promise<void>;
	now(): number;
}

export interface EnsureDaemonOptions {
	readyTimeoutMs?: number;
	pollIntervalMs?: number;
	readonly signal?: AbortSignal;
}

export async function ensureDaemonRunning(
	paths: DaemonPaths,
	deps: EnsureDaemonDeps = defaultEnsureDaemonDeps(),
	options: EnsureDaemonOptions = {},
): Promise<void> {
	const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const signal = options.signal;

	throwIfAborted(signal);
	if (await awaitWithSignal(deps.probe(paths, signal), signal)) return;
	throwIfAborted(signal);
	deps.spawnDaemon(paths);
	await waitUntilReachable(paths, deps, readyTimeoutMs, pollIntervalMs, signal);
}

async function waitUntilReachable(
	paths: DaemonPaths,
	deps: EnsureDaemonDeps,
	readyTimeoutMs: number,
	pollIntervalMs: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	const deadline = deps.now() + readyTimeoutMs;
	for (;;) {
		throwIfAborted(signal);
		if (await awaitWithSignal(deps.probe(paths, signal), signal)) return;
		if (deps.now() >= deadline) throw new DaemonUnreachableError(paths.socket);
		await awaitWithSignal(deps.sleep(pollIntervalMs, signal), signal);
	}
}

export async function probeDaemon(
	paths: DaemonPaths,
	timeoutMs: number = PROBE_TIMEOUT_MS,
	signal?: AbortSignal,
): Promise<boolean> {
	const token = readAuthToken(paths);
	if (!token) return false;
	return (await pingDaemon(paths, token, timeoutMs, signal)) !== null;
}

export function pingDaemon(
	paths: DaemonPaths,
	token: string,
	timeoutMs: number = PROBE_TIMEOUT_MS,
	signal?: AbortSignal,
): Promise<OwnerPing | null> {
	return new Promise((resolve) => {
		const socket = new Socket();
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (value: OwnerPing | null): void => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			socket.destroy();
			resolve(value);
		};
		const onAbort = (): void => finish(null);
		const decoder = createLineDecoder((message) => {
			finish(parsePingResponse(message));
		});
		socket.once("connect", () => {
			socket.write(
				encodeJsonLine({ jsonrpc: "2.0", id: 1, method: "omo/ping", params: { _omo: authEnvelope(token) } }),
			);
		});
		socket.on("data", (chunk) => decoder.push(chunk));
		socket.once("error", () => {
			finish(null);
		});
		timer = setTimeout(() => finish(null), timeoutMs);
		timer.unref?.();
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		socket.connect(paths.socket);
	});
}

export function spawnDaemonProcess(paths: DaemonPaths): void {
	mkdirSync(dirname(paths.log), { recursive: true });
	const logFd = openSync(paths.log, "a");
	try {
		const child = spawn(execPath, [paths.cliPath, "daemon"], {
			detached: true,
			stdio: ["ignore", logFd, logFd],
		});
		child.unref();
	} finally {
		closeSync(logFd);
	}
}

export function resolveDaemonCliPath(
	env: NodeJS.ProcessEnv = process.env,
	defaults: DaemonRuntimeDefaults = packagedRuntimeDefaults(),
): string {
	return resolveDaemonRuntime(env, defaults).cliPath;
}

export function defaultEnsureDaemonDeps(): EnsureDaemonDeps {
	return {
		probe: (paths, signal) => probeDaemon(paths, PROBE_TIMEOUT_MS, signal),
		spawnDaemon: (paths) => spawnDaemonProcess(paths),
		sleep: (ms, signal) => sleepWithSignal(ms, signal),
		now: () => Date.now(),
	};
}

function sleepWithSignal(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", finish);
			resolve();
		};
		const timer = setTimeout(finish, ms);
		if (signal?.aborted) {
			finish();
			return;
		}
		signal?.addEventListener("abort", finish, { once: true });
	});
}

function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(abortError(signal));
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const finish = (run: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			run();
		};
		const onAbort = (): void => finish(() => reject(abortError(signal)));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(error)),
		);
	});
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
	const reason = signal.reason;
	if (reason instanceof Error) return reason;
	const error = new Error(typeof reason === "string" ? reason : "daemon startup cancelled");
	error.name = "AbortError";
	return error;
}

function parsePingResponse(message: unknown): OwnerPing | null {
	if (!message || typeof message !== "object" || Array.isArray(message)) return null;
	const result = Reflect.get(message, "result");
	if (!result || typeof result !== "object" || Array.isArray(result)) return null;
	const pid = Reflect.get(result, "pid");
	const nonce = Reflect.get(result, "nonce");
	const startedAt = Reflect.get(result, "startedAt");
	const endpoint = Reflect.get(result, "endpoint");
	if (typeof pid !== "number" || typeof nonce !== "string" || typeof startedAt !== "string") return null;
	if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) return null;
	const path = Reflect.get(endpoint, "path");
	const kind = Reflect.get(endpoint, "kind");
	if (typeof path !== "string") return null;
	if (kind === "windows") return { pid, nonce, startedAt, endpoint: { kind, path } };
	if (kind === "missing") return { pid, nonce, startedAt, endpoint: { kind, path } };
	const dev = Reflect.get(endpoint, "dev");
	const ino = Reflect.get(endpoint, "ino");
	if (kind === "unix" && typeof dev === "number" && typeof ino === "number") {
		return { pid, nonce, startedAt, endpoint: { kind, path, dev, ino } };
	}
	return null;
}
