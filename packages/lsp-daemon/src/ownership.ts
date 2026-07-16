import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { tryAcquireLock, type LockHandle, isProcessAlive, unlinkQuietly } from "./lock.js";
import {
	ensurePrivateDirectory,
	readAuthToken,
	readOrCreateAuthToken,
	rotateAuthToken,
	writePrivateFile,
} from "./ipc-protocol.js";
import type { DaemonPaths } from "./paths.js";

export type EndpointIdentity =
	| { readonly kind: "unix"; readonly path: string; readonly dev: number; readonly ino: number }
	| { readonly kind: "windows"; readonly path: string }
	| { readonly kind: "missing"; readonly path: string };

export type DaemonOwner = {
	readonly pid: number;
	readonly nonce: string;
	readonly startedAt: string;
	readonly endpoint: EndpointIdentity;
};

export type StartupLease = {
	readonly lock: LockHandle;
	readonly token: string;
	readonly owner: DaemonOwner;
};

export class DaemonAlreadyRunningError extends Error {
	override readonly name = "DaemonAlreadyRunningError";
	readonly code = "daemon_already_running";
}

export class DaemonStartupDeferredError extends Error {
	override readonly name = "DaemonStartupDeferredError";
	readonly code = "daemon_startup_deferred";

	constructor(readonly reason: string) {
		super(`LSP daemon startup deferred: ${reason}`);
	}
}

export type OwnerPing = {
	readonly pid: number;
	readonly nonce: string;
	readonly startedAt: string;
	readonly endpoint: EndpointIdentity;
};

export async function acquireStartupLease(
	paths: DaemonPaths,
	pingOwner: (token: string) => Promise<OwnerPing | null>,
): Promise<StartupLease> {
	ensureDaemonDirectories(paths);
	const lock = tryAcquireLock(paths.lock);
	if (!lock) {
		const token = readAuthToken(paths);
		if (token && (await pingOwner(token))) throw new DaemonAlreadyRunningError("LSP daemon already running");
		throw new DaemonStartupDeferredError("startup_lock_busy");
	}
	try {
		const token = await validateExistingOwner(paths, pingOwner);
		return { lock, token, owner: newOwner(paths) };
	} catch (error) {
		lock.release();
		throw error;
	}
}

export function ensureDaemonDirectories(paths: DaemonPaths): void {
	ensurePrivateDirectory(paths.dir);
	if (process.platform !== "win32") ensurePrivateDirectory(dirname(paths.socket));
}

export function readDaemonOwner(paths: DaemonPaths): DaemonOwner | null {
	try {
		return parseOwner(JSON.parse(readFileSync(paths.owner, "utf8")));
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

export function writeDaemonOwner(paths: DaemonPaths, owner: DaemonOwner): void {
	writePrivateFile(paths.pid, `${owner.pid}\n`);
	writePrivateFile(paths.endpoint, owner.endpoint.path);
	writePrivateFile(paths.owner, `${JSON.stringify(owner)}\n`);
}

export function removeDaemonMetadataForOwner(paths: DaemonPaths, owner: DaemonOwner): void {
	const current = readDaemonOwner(paths);
	if (!current || !sameOwner(current, owner)) return;
	unlinkQuietly(paths.socket);
	unlinkQuietly(paths.pid);
	unlinkQuietly(paths.endpoint);
	unlinkQuietly(paths.owner);
}

export function endpointIdentity(endpointPath: string): EndpointIdentity {
	if (process.platform === "win32") return { kind: "windows", path: endpointPath };
	try {
		const stats = statSync(endpointPath);
		return { kind: "unix", path: endpointPath, dev: stats.dev, ino: stats.ino };
	} catch (error) {
		if (error instanceof Error) return { kind: "missing", path: endpointPath };
		throw error;
	}
}

export function sameEndpoint(a: EndpointIdentity, b: EndpointIdentity): boolean {
	if (a.kind !== b.kind || a.path !== b.path) return false;
	switch (a.kind) {
		case "unix":
			return b.kind === "unix" && a.dev === b.dev && a.ino === b.ino;
		case "windows":
			return true;
		case "missing":
			return true;
	}
}

export function sameOwner(a: DaemonOwner, b: DaemonOwner): boolean {
	return a.pid === b.pid && a.nonce === b.nonce && sameEndpoint(a.endpoint, b.endpoint);
}

async function validateExistingOwner(
	paths: DaemonPaths,
	pingOwner: (token: string) => Promise<OwnerPing | null>,
): Promise<string> {
	let token = readOrCreateAuthToken(paths);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const owner = readDaemonOwner(paths);
		if (!owner) return token;
		const ping = await pingOwner(token);
		if (ping && owner.nonce === ping.nonce && sameEndpoint(owner.endpoint, ping.endpoint)) {
			throw new DaemonAlreadyRunningError("LSP daemon already running");
		}
		if (ping) continue;
		if (isProcessAlive(owner.pid)) throw new DaemonStartupDeferredError("owner_pid_live_unreachable");
		const reread = readDaemonOwner(paths);
		const endpoint = endpointIdentity(owner.endpoint.path);
		if (!reread || reread.nonce !== owner.nonce || !sameEndpoint(endpoint, owner.endpoint)) {
			throw new DaemonStartupDeferredError("owner_changed_during_cleanup");
		}
		cleanupDeadOwner(paths, owner);
		token = rotateAuthToken(paths);
		return token;
	}
	throw new DaemonStartupDeferredError("reachable_owner_mismatch");
}

function cleanupDeadOwner(paths: DaemonPaths, owner: DaemonOwner): void {
	if (process.platform !== "win32" && existsSync(owner.endpoint.path)) {
		const stat = lstatSync(owner.endpoint.path);
		if (stat.isSocket()) unlinkSync(owner.endpoint.path);
	}
	unlinkQuietly(paths.pid);
	unlinkQuietly(paths.endpoint);
	unlinkQuietly(paths.owner);
}

function newOwner(paths: DaemonPaths): DaemonOwner {
	return {
		pid: process.pid,
		nonce: randomUUID(),
		startedAt: new Date().toISOString(),
		endpoint: endpointIdentity(paths.socket),
	};
}

function parseOwner(value: unknown): DaemonOwner | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const pid = Reflect.get(value, "pid");
	const nonce = Reflect.get(value, "nonce");
	const startedAt = Reflect.get(value, "startedAt");
	const endpoint = parseEndpoint(Reflect.get(value, "endpoint"));
	if (typeof pid !== "number" || typeof nonce !== "string" || typeof startedAt !== "string" || !endpoint) return null;
	return { pid, nonce, startedAt, endpoint };
}

function parseEndpoint(value: unknown): EndpointIdentity | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const kind = Reflect.get(value, "kind");
	const path = Reflect.get(value, "path");
	if (typeof path !== "string") return null;
	if (kind === undefined) return endpointIdentity(path);
	if (kind === "windows") return { kind, path };
	if (kind === "missing") return { kind, path };
	const dev = Reflect.get(value, "dev");
	const ino = Reflect.get(value, "ino");
	if (kind === "unix" && typeof dev === "number" && typeof ino === "number") return { kind, path, dev, ino };
	return null;
}
