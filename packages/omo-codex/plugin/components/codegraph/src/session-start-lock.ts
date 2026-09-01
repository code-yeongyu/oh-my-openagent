import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";

import { resolveSessionStartStatePaths, stateParent } from "./session-start-paths.js";

export interface SessionStartLock {
	readonly path: string;
	readonly token: string;
}

export type SessionStartLockResult =
	| { readonly kind: "acquired"; readonly lock: SessionStartLock; readonly recoveredStale: boolean }
	| { readonly kind: "inconclusive"; readonly reason: string }
	| { readonly kind: "locked" };

export interface AcquireSessionStartLockOptions {
	readonly homeDir: string;
	readonly nowMs: number;
	readonly projectRoot: string;
	readonly staleMs: number;
}

type LockSnapshot =
	| { readonly kind: "inconclusive"; readonly reason: string }
	| { readonly kind: "missing" }
	| { readonly kind: "present"; readonly mtimeMs: number; readonly raw: string; readonly token: string };

export function acquireSessionStartLock(options: AcquireSessionStartLockOptions): SessionStartLockResult {
	const paths = resolveSessionStartStatePaths(options.homeDir, options.projectRoot);
	const lockPath = paths.lockPath;
	const canonicalOptions = { ...options, projectRoot: paths.canonicalProjectRoot };
	try {
		mkdirSync(stateParent(lockPath), { recursive: true });
	} catch (error) {
		if (error instanceof Error) return { kind: "inconclusive", reason: error.message };
		throw error;
	}

	const initial = tryCreateLock(lockPath, canonicalOptions.projectRoot);
	if (initial.kind !== "locked") return initial;

	const snapshot = readLockSnapshot(lockPath);
	if (snapshot.kind === "missing") return tryCreateLock(lockPath, canonicalOptions.projectRoot);
	if (snapshot.kind === "inconclusive") return snapshot;
	if (canonicalOptions.nowMs - snapshot.mtimeMs < canonicalOptions.staleMs) return { kind: "locked" };
	return reclaimStaleLock(lockPath, snapshot, canonicalOptions);
}

export function releaseSessionStartLock(lock: SessionStartLock): boolean {
	const snapshot = readLockSnapshot(lock.path);
	if (snapshot.kind !== "present" || snapshot.token !== lock.token) return false;
	try {
		rmSync(lock.path, { force: true });
		return true;
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

export function sessionStartLockIsOwned(lock: SessionStartLock): boolean {
	const snapshot = readLockSnapshot(lock.path);
	return snapshot.kind === "present" && snapshot.token === lock.token;
}

function reclaimStaleLock(
	lockPath: string,
	staleSnapshot: Extract<LockSnapshot, { readonly kind: "present" }>,
	options: AcquireSessionStartLockOptions,
): SessionStartLockResult {
	const reclaimPath = `${lockPath}.reclaim`;
	const reclaim = tryCreateMarker(reclaimPath);
	if (reclaim.kind !== "acquired") return reclaim;

	try {
		const current = readLockSnapshot(lockPath);
		if (current.kind === "inconclusive") return current;
		if (current.kind === "present") {
			const changed = current.raw !== staleSnapshot.raw || current.mtimeMs !== staleSnapshot.mtimeMs;
			if (changed || options.nowMs - current.mtimeMs < options.staleMs) return { kind: "locked" };
			rmSync(lockPath, { force: true });
		}
		const acquired = tryCreateLock(lockPath, options.projectRoot);
		return acquired.kind === "acquired" ? { ...acquired, recoveredStale: true } : acquired;
	} catch (error) {
		if (error instanceof Error) return { kind: "inconclusive", reason: error.message };
		throw error;
	} finally {
		rmSync(reclaimPath, { force: true });
	}
}

function tryCreateLock(lockPath: string, projectRoot: string): SessionStartLockResult {
	const token = randomUUID();
	try {
		writeFileSync(lockPath, `${JSON.stringify({ projectRoot, token })}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		return { kind: "acquired", lock: { path: lockPath, token }, recoveredStale: false };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		if (errorCode(error) === "EEXIST") return { kind: "locked" };
		return { kind: "inconclusive", reason: error.message };
	}
}

function tryCreateMarker(path: string): { readonly kind: "acquired" } | { readonly kind: "inconclusive"; readonly reason: string } | { readonly kind: "locked" } {
	try {
		writeFileSync(path, `${randomUUID()}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
		return { kind: "acquired" };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		if (errorCode(error) === "EEXIST") return { kind: "locked" };
		return { kind: "inconclusive", reason: error.message };
	}
}

function readLockSnapshot(path: string): LockSnapshot {
	try {
		const raw = readFileSync(path, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return { kind: "inconclusive", reason: "lock body is not an object" };
		const token = Reflect.get(parsed, "token");
		if (typeof token !== "string" || token.length === 0) return { kind: "inconclusive", reason: "lock token is missing" };
		return { kind: "present", mtimeMs: statSync(path).mtimeMs, raw, token };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		if (errorCode(error) === "ENOENT") return { kind: "missing" };
		return { kind: "inconclusive", reason: error.message };
	}
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code = Reflect.get(error, "code");
	return typeof code === "string" ? code : undefined;
}
