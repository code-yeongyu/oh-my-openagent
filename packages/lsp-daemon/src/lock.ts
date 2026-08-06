import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export interface LockHandle {
	release(): void;
}

export function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error instanceof Error) return errorCode(error) === "EPERM";
		throw error;
	}
}

export function readLockPid(lockPath: string): number | null {
	try {
		const pid = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
		return Number.isInteger(pid) ? pid : null;
	} catch {
		return null;
	}
}

export function tryAcquireLock(lockPath: string, ownerPid: number = process.pid): LockHandle | null {
	mkdirSync(dirname(lockPath), { recursive: true });
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const handle = writeLockFile(lockPath, ownerPid);
		if (handle) return handle;
		if (!reapStaleLock(lockPath)) return null;
	}
	return null;
}

function writeLockFile(lockPath: string, ownerPid: number): LockHandle | null {
	try {
		const fd = openSync(lockPath, "wx", 0o600);
		writeSync(fd, `${ownerPid}\n`);
		closeSync(fd);
		return { release: () => unlinkQuietly(lockPath) };
	} catch (error) {
		if (errorCode(error) === "EEXIST") return null;
		throw error;
	}
}

function reapStaleLock(lockPath: string): boolean {
	const pid = readLockPid(lockPath);
	if (pid !== null && isProcessAlive(pid)) return false;
	unlinkQuietly(lockPath);
	return true;
}

export function unlinkQuietly(path: string): void {
	try {
		unlinkSync(path);
	} catch (error) {
		if (error instanceof Error) return;
		throw error;
	}
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error)) return undefined;
	const code = Reflect.get(error, "code");
	return typeof code === "string" ? code : undefined;
}
