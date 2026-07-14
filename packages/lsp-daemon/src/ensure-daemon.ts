import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { connect } from "node:net";
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
	probe(paths: DaemonPaths): Promise<boolean>;
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

	if (await deps.probe(paths)) return;
	deps.spawnDaemon(paths);
	await waitUntilReachable(paths, deps, readyTimeoutMs, pollIntervalMs);
}

async function waitUntilReachable(
	paths: DaemonPaths,
	deps: EnsureDaemonDeps,
	readyTimeoutMs: number,
	pollIntervalMs: number,
): Promise<void> {
	const deadline = deps.now() + readyTimeoutMs;
	for (;;) {
		if (await deps.probe(paths)) return;
		if (deps.now() >= deadline) throw new DaemonUnreachableError(paths.socket);
		await deps.sleep(pollIntervalMs);
	}
}

export async function probeDaemon(paths: DaemonPaths, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<boolean> {
	const token = readAuthToken(paths);
	if (!token) return false;
	return (await pingDaemon(paths, token, timeoutMs)) !== null;
}

export function pingDaemon(paths: DaemonPaths, token: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<OwnerPing | null> {
	return new Promise((resolve) => {
		const socket = connect(paths.socket);
		let settled = false;
		const finish = (value: OwnerPing | null): void => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(value);
		};
		const timer = setTimeout(() => finish(null), timeoutMs);
		timer.unref?.();
		const decoder = createLineDecoder((message) => {
			clearTimeout(timer);
			finish(parsePingResponse(message));
		});
		socket.once("connect", () => {
			socket.write(encodeJsonLine({ jsonrpc: "2.0", id: 1, method: "omo/ping", params: { _omo: authEnvelope(token) } }));
		});
		socket.on("data", (chunk) => decoder.push(chunk));
		socket.once("error", () => {
			clearTimeout(timer);
			finish(null);
		});
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
		probe: (paths) => probeDaemon(paths),
		spawnDaemon: (paths) => spawnDaemonProcess(paths),
		sleep: (ms) =>
			new Promise((resolve) => {
				setTimeout(resolve, ms);
			}),
		now: () => Date.now(),
	};
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
