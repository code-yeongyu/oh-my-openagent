import { randomUUID } from "node:crypto";
import { closeSync, ftruncateSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { UlwLoopError } from "./types.js";

// O_EXCL establishes ownership. Async holders keep the fd open and refresh a
// lease through that fd, never through the pathname: a reclaimed inode is invisible.
// Sync/legacy holders are lease-less and only dead pids retire their records.
// Expiry permits overlapping bodies; immutable revision publication fences them.
// Reclaim's reread/unlink is not atomic. On Windows an open inode may not unlink:
// treat that refusal as a live owner and fail closed. Release checks its token.
export const ULW_LOOP_LOCK_TIMEOUT_CODE = "ULW_LOOP_LOCK_TIMEOUT";
export interface StateLockClock {
	readonly now: () => number;
	readonly schedule: (fn: () => void, ms: number) => { unref(): void; cancel(): void };
}
export interface StateLockOptions {
	readonly timeoutMs?: number;
	readonly staleMs?: number;
	readonly leaseMs?: number;
	readonly heartbeatMs?: number;
	readonly clock?: StateLockClock;
}
interface LockRecord {
	readonly pid: number;
	readonly createdAt: string;
	readonly token: string;
	leaseUntil?: number;
}
interface Holder {
	readonly fd: number;
	readonly record: LockRecord;
}
interface LockSnapshot {
	readonly raw: string;
	readonly record: LockRecord | null;
	readonly ageMs: number;
}
type AttemptOutcome = { readonly kind: "acquired"; readonly holder: Holder } | { readonly kind: "retry" | "wait" };
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 60_000;
const DEFAULT_LEASE_MS = 30_000;
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));
const systemClock: StateLockClock = {
	now: Date.now,
	schedule(fn, ms) {
		const timer = setTimeout(fn, ms);
		return {
			unref: () => {
				timer.unref();
			},
			cancel: () => clearTimeout(timer),
		};
	},
};

export async function withStateLock<T>(
	lockPath: string,
	fn: (token: string) => Promise<T>,
	options: StateLockOptions = {},
): Promise<T> {
	const holder = await acquireAsync(lockPath, options);
	const clock = options.clock ?? systemClock;
	let timer: ReturnType<StateLockClock["schedule"]> | undefined;
	let heartbeatError: unknown;
	const beat = () => {
		try {
			holder.record.leaseUntil = clock.now() + (options.leaseMs ?? DEFAULT_LEASE_MS);
			writeRecord(holder);
			schedule();
		} catch (error) {
			heartbeatError = error;
		}
	};
	const schedule = () => {
		if (options.heartbeatMs === 0) return;
		timer = clock.schedule(beat, options.heartbeatMs ?? (options.leaseMs ?? DEFAULT_LEASE_MS) / 3);
		timer.unref();
	};
	schedule();
	try {
		const result = await fn(holder.record.token);
		if (heartbeatError !== undefined) throw heartbeatError;
		return result;
	} finally {
		timer?.cancel();
		closeSync(holder.fd);
		release(lockPath, holder.record.token);
	}
}
export function withStateLockSync<T>(lockPath: string, fn: () => T, options: StateLockOptions = {}): T {
	const holder = acquireSync(lockPath, options);
	try {
		return fn();
	} finally {
		closeSync(holder.fd);
		release(lockPath, holder.record.token);
	}
}
export function isStateLockTimeout(error: unknown): error is UlwLoopError {
	return error instanceof UlwLoopError && error.code === ULW_LOOP_LOCK_TIMEOUT_CODE;
}
async function acquireAsync(lockPath: string, options: StateLockOptions): Promise<Holder> {
	const clock = options.clock ?? systemClock;
	const deadline = clock.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	mkdirSync(dirname(lockPath), { recursive: true });
	for (let attempt = 0; ; ) {
		const outcome = attemptOnce(lockPath, options, clock.now(), options.leaseMs ?? DEFAULT_LEASE_MS);
		if (outcome.kind === "acquired") return outcome.holder;
		if (outcome.kind === "retry") continue;
		if (clock.now() >= deadline) throw lockTimeout(lockPath, options);
		await new Promise<void>((resolve) => clock.schedule(resolve, backoffMs(attempt)));
		attempt += 1;
	}
}
function acquireSync(lockPath: string, options: StateLockOptions): Holder {
	const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	mkdirSync(dirname(lockPath), { recursive: true });
	for (let attempt = 0; ; ) {
		const outcome = attemptOnce(lockPath, options, Date.now());
		if (outcome.kind === "acquired") return outcome.holder;
		if (outcome.kind === "retry") continue;
		if (Date.now() >= deadline) throw lockTimeout(lockPath, options);
		Atomics.wait(SLEEP_CELL, 0, 0, backoffMs(attempt));
		attempt += 1;
	}
}
function attemptOnce(lockPath: string, options: StateLockOptions, now: number, leaseMs?: number): AttemptOutcome {
	try {
		const holder = tryCreate(lockPath, now, leaseMs);
		if (holder !== null) return { kind: "acquired", holder };
		const snapshot = readSnapshot(lockPath, now);
		if (snapshot === null) return { kind: "retry" };
		const record = snapshot.record;
		const stale =
			record === null
				? snapshot.ageMs > (options.staleMs ?? DEFAULT_STALE_MS)
				: !isProcessAlive(record.pid) || (record.leaseUntil !== undefined && now > record.leaseUntil);
		if (stale && reclaim(lockPath, snapshot.raw)) return { kind: "retry" };
		return { kind: "wait" };
	} catch (error) {
		if (hasCode(error, "EINTR")) return { kind: "wait" };
		throw error;
	}
}
function writeRecord(holder: Holder): void {
	const buf = Buffer.from(JSON.stringify(holder.record));
	ftruncateSync(holder.fd, 0);
	let offset = 0;
	while (offset < buf.length) {
		const written = writeSync(holder.fd, buf, offset, buf.length - offset, offset);
		if (written === 0) throw new Error("State lock write made no progress.");
		offset += written;
	}
}
function tryCreate(lockPath: string, now: number, leaseMs?: number): Holder | null {
	let fd: number;
	try {
		fd = openSync(lockPath, "wx");
	} catch (error) {
		if (hasCode(error, "EEXIST")) return null;
		throw error;
	}
	const record: LockRecord = {
		pid: process.pid,
		createdAt: new Date(now).toISOString(),
		token: randomUUID(),
		...(leaseMs === undefined ? {} : { leaseUntil: now + leaseMs }),
	};
	const holder = { fd, record };
	try {
		writeRecord(holder);
	} catch (error) {
		closeSync(fd);
		try {
			unlinkSync(lockPath);
		} catch (cleanup) {
			if (!hasCode(cleanup, "ENOENT")) throw cleanup;
		}
		throw error;
	}
	return holder;
}
function readSnapshot(lockPath: string, now: number): LockSnapshot | null {
	try {
		const raw = readFileSync(lockPath, "utf8");
		return { raw, record: parseRecord(raw), ageMs: now - statSync(lockPath).mtimeMs };
	} catch (error) {
		if (hasCode(error, "ENOENT")) return null;
		throw error;
	}
}
function parseRecord(raw: string): LockRecord | null {
	try {
		const record: unknown = JSON.parse(raw);
		if (typeof record !== "object" || record === null) return null;
		if (!("pid" in record) || typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 0)
			return null;
		if (!("createdAt" in record) || typeof record.createdAt !== "string") return null;
		if (!("token" in record) || typeof record.token !== "string" || record.token.length === 0) return null;
		return {
			pid: record.pid,
			createdAt: record.createdAt,
			token: record.token,
			...("leaseUntil" in record && typeof record.leaseUntil === "number" ? { leaseUntil: record.leaseUntil } : {}),
		};
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		throw error;
	}
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
function reclaim(lockPath: string, expectedRaw: string): boolean {
	const current = readSnapshot(lockPath, Date.now());
	if (current === null) return true;
	if (current.raw !== expectedRaw) return false;
	try {
		unlinkSync(lockPath);
	} catch (error) {
		if (hasCode(error, "EPERM") || hasCode(error, "EACCES")) return false;
		if (!hasCode(error, "ENOENT")) throw error;
	}
	return true;
}
function release(lockPath: string, token: string): void {
	if (readSnapshot(lockPath, Date.now())?.record?.token !== token) return;
	try {
		unlinkSync(lockPath);
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
	}
}
function backoffMs(attempt: number): number {
	return Math.min(100, 5 * 2 ** attempt) + Math.random() * 5;
}
function lockTimeout(lockPath: string, options: StateLockOptions): UlwLoopError {
	const holder = readSnapshot(lockPath, Date.now())?.record;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const owner = holder == null ? "another process" : `pid ${holder.pid}`;
	return new UlwLoopError(
		`ulw-loop state lock ${lockPath} is held by ${owner} for more than ${timeoutMs}ms. The lock owner is still alive. If a JS eval kernel was interrupted while writing, wait for its lease to expire (${options.leaseMs ?? DEFAULT_LEASE_MS} ms) or restart the owning senpi process; never delete a lock owned by a live process.`,
		ULW_LOOP_LOCK_TIMEOUT_CODE,
		{ details: { lockPath, timeoutMs, ...(holder == null ? {} : { holderPid: holder.pid }) } },
	);
}
function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
