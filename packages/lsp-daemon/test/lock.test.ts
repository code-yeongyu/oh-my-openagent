import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isProcessAlive, readLockPid, tryAcquireLock } from "../src/lock.js";

const tempDirectories: string[] = [];
const DEAD_PID = 2_000_000_000;

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function tempLockPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsp-daemon-lock-"));
	tempDirectories.push(dir);
	return join(dir, "nested", "daemon.lock");
}

describe("daemon lock", () => {
	it("#given current process #when isProcessAlive #then true", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("#given a dead pid #when isProcessAlive #then false", () => {
		expect(isProcessAlive(DEAD_PID)).toBe(false);
	});

	it("#given free path #when tryAcquireLock #then writes owner pid and holds lock", () => {
		const lockPath = tempLockPath();
		const handle = tryAcquireLock(lockPath);
		expect(handle).not.toBeNull();
		expect(readLockPid(lockPath)).toBe(process.pid);
		expect(tryAcquireLock(lockPath)).toBeNull();
		handle?.release();
		expect(tryAcquireLock(lockPath)).not.toBeNull();
	});

	it("#given a stale lock owned by a dead pid #when tryAcquireLock #then reaps and acquires", () => {
		const lockPath = tempLockPath();
		const first = tryAcquireLock(lockPath, process.pid);
		first?.release();
		writeFileSync(lockPath, `${DEAD_PID}\n`);
		const handle = tryAcquireLock(lockPath);
		expect(handle).not.toBeNull();
		expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
	});
});
