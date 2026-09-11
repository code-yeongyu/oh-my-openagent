import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { UlwLoopError } from "./types.js";

// Cross-process exclusive lock for one ulw-loop state directory. Every CLI
// invocation is its own process, so the in-process promise chain in plan-io
// serializes nothing across them; this file-level lock is what makes the
// read-modify-write of goals.json (and the counters next to it) atomic.
//
// Protocol: the lock is a file created with O_EXCL whose body records the
// owner (pid + a per-acquisition token). A waiter reclaims it only when the
// owner is provably gone (pid dead) or the body never became a record within
// `staleMs` (a creator that died mid-write); a live owner is never reclaimed by
// age alone, because overlapping two bodies is exactly the lost update this lock
// exists to prevent. Waiters back off and fail closed at `timeoutMs`. Release
// unlinks only a lock that still carries the releaser's own token.

export const ULW_LOOP_LOCK_TIMEOUT_CODE = "ULW_LOOP_LOCK_TIMEOUT";

export interface StateLockOptions {
	readonly timeoutMs?: number;
	readonly staleMs?: number;
}

interface LockRecord {
	readonly pid: number;
	readonly createdAt: string;
	readonly token: string;
}

interface LockSnapshot {
	readonly raw: string;
	readonly record: LockRecord | null;
	readonly ageMs: number;
}

type AttemptOutcome = { readonly kind: "acquired"; readonly token: string } | { readonly kind: "retry" | "wait" };

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 60_000;
const MIN_DELAY_MS = 5;
const MAX_DELAY_MS = 100;
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

export async function withStateLock<T>(
	lockPath: string,
	fn: () => Promise<T>,
	options: StateLockOptions = {},
): Promise<T> {
	const token = await acquireAsync(lockPath, options);
	try {
		return await fn();
	} finally {
		release(lockPath, token);
	}
}

export function withStateLockSync<T>(lockPath: string, fn: () => T, options: StateLockOptions = {}): T {
	const token = acquireSync(lockPath, options);
	try {
		return fn();
	} finally {
		release(lockPath, token);
	}
}

export function isStateLockTimeout(error: unknown): error is UlwLoopError {
	return error instanceof UlwLoopError && error.code === ULW_LOOP_LOCK_TIMEOUT_CODE;
}

async function acquireAsync(lockPath: string, options: StateLockOptions): Promise<string> {
	const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	mkdirSync(dirname(lockPath), { recursive: true });
	for (let attempt = 0; ; ) {
		const outcome = attemptOnce(lockPath, staleMs);
		if (outcome.kind === "acquired") return outcome.token;
		if (outcome.kind === "retry") continue;
		if (Date.now() >= deadline) throw lockTimeout(lockPath, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		await sleep(backoffMs(attempt));
		attempt += 1;
	}
}

function acquireSync(lockPath: string, options: StateLockOptions): string {
	const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	mkdirSync(dirname(lockPath), { recursive: true });
	for (let attempt = 0; ; ) {
		const outcome = attemptOnce(lockPath, staleMs);
		if (outcome.kind === "acquired") return outcome.token;
		if (outcome.kind === "retry") continue;
		if (Date.now() >= deadline) throw lockTimeout(lockPath, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		Atomics.wait(SLEEP_CELL, 0, 0, backoffMs(attempt));
		attempt += 1;
	}
}

// EINTR surfaces raw from macOS fs syscalls under some runtimes; it is a retry, never a verdict.
function attemptOnce(lockPath: string, staleMs: number): AttemptOutcome {
	try {
		const token = tryCreate(lockPath);
		if (token !== null) return { kind: "acquired", token };
		const snapshot = readSnapshot(lockPath);
		if (snapshot === null) return { kind: "retry" };
		if (isStale(snapshot, staleMs) && reclaim(lockPath, snapshot.raw)) return { kind: "retry" };
		return { kind: "wait" };
	} catch (error) {
		if (hasCode(error, "EINTR")) return { kind: "wait" };
		throw error;
	}
}

function tryCreate(lockPath: string): string | null {
	let fd: number;
	try {
		fd = openSync(lockPath, "wx");
	} catch (error) {
		if (hasCode(error, "EEXIST")) return null;
		throw error;
	}
	const record: LockRecord = { pid: process.pid, createdAt: new Date().toISOString(), token: randomUUID() };
	try {
		writeSync(fd, JSON.stringify(record));
	} catch (error) {
		closeSync(fd);
		// A failed write (e.g. EINTR) must not leave a partial lock the owner never recorded;
		// otherwise later readers see a young ownerless lock and only age can retire it.
		try {
			unlinkSync(lockPath);
		} catch {
			// another process already reclaimed the partial file; leave it alone
		}
		throw error;
	}
	closeSync(fd);
	return record.token;
}

function readSnapshot(lockPath: string): LockSnapshot | null {
	try {
		const raw = readFileSync(lockPath, "utf8");
		const ageMs = Date.now() - statSync(lockPath).mtimeMs;
		return { raw, record: parseRecord(raw), ageMs };
	} catch (error) {
		if (hasCode(error, "ENOENT")) return null;
		throw error;
	}
}

function parseRecord(raw: string): LockRecord | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return null;
		const record = parsed as Record<string, unknown>;
		const pid = record["pid"];
		const createdAt = record["createdAt"];
		const token = record["token"];
		if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0 || typeof createdAt !== "string") return null;
		if (typeof token !== "string" || token.length === 0) return null;
		return { pid, createdAt, token };
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		throw error;
	}
}

// A body that is not a record is a lock mid-write (or a foreign/legacy file); only
// age retires it. A parsable record is stale only when its owner is dead: a live
// owner running past staleMs is slow, not gone, and the waiter fails closed instead.
function isStale(snapshot: LockSnapshot, staleMs: number): boolean {
	if (snapshot.record === null) return snapshot.ageMs > staleMs;
	return !isProcessAlive(snapshot.record.pid);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (hasCode(error, "ESRCH")) return false;
		if (hasCode(error, "EPERM")) return true;
		throw error;
	}
}

// Re-read right before unlinking so a lock that changed hands since the stale
// verdict (a sibling waiter reclaimed and re-acquired it) is left alone.
function reclaim(lockPath: string, expectedRaw: string): boolean {
	const current = readSnapshot(lockPath);
	if (current === null) return true;
	if (current.raw !== expectedRaw) return false;
	try {
		unlinkSync(lockPath);
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
	}
	return true;
}

// Only the acquisition that wrote this token may unlink: if the file now carries
// another token, a waiter has legitimately taken over and its lock must stand.
function release(lockPath: string, token: string): void {
	const current = readSnapshot(lockPath);
	if (current === null || current.record?.token !== token) return;
	try {
		unlinkSync(lockPath);
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
	}
}

function backoffMs(attempt: number): number {
	const exponential = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** attempt);
	return exponential + Math.random() * MIN_DELAY_MS;
}

function lockTimeout(lockPath: string, timeoutMs: number): UlwLoopError {
	const holder = readSnapshot(lockPath)?.record;
	const owner = holder === undefined || holder === null ? "another process" : `pid ${holder.pid}`;
	return new UlwLoopError(
		`ulw-loop state lock ${lockPath} is held by ${owner} for more than ${timeoutMs}ms; retry once that process finishes, or delete the lock file if that process is gone.`,
		ULW_LOOP_LOCK_TIMEOUT_CODE,
		{
			details: {
				lockPath,
				timeoutMs,
				...(holder === undefined || holder === null ? {} : { holderPid: holder.pid }),
			},
		},
	);
}

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
