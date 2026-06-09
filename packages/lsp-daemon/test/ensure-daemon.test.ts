import { describe, expect, it } from "vitest";

import { DaemonUnreachableError, type EnsureDaemonDeps, ensureDaemonRunning } from "../src/ensure-daemon.js";
import type { LockHandle } from "../src/lock.js";
import { daemonPaths } from "../src/paths.js";

const PATHS = daemonPaths({ CODEX_LSP_DAEMON_DIR: "/tmp/ensure-test" }, "9.9.9");

interface Harness {
	deps: EnsureDaemonDeps;
	counts: { spawn: number; cleanup: number; lockAcquired: number; lockReleased: number };
}

function makeHarness(config: { probeQueue: boolean[]; lockAvailable: boolean; onSpawnPush?: boolean[] }): Harness {
	const queue = [...config.probeQueue];
	const counts = { spawn: 0, cleanup: 0, lockAcquired: 0, lockReleased: 0 };
	let now = 0;

	const handle: LockHandle = {
		release: () => {
			counts.lockReleased += 1;
		},
	};

	const deps: EnsureDaemonDeps = {
		probe: () => Promise.resolve(queue.shift() ?? false),
		acquireLock: () => {
			if (!config.lockAvailable) return null;
			counts.lockAcquired += 1;
			return handle;
		},
		cleanupStaleSocket: () => {
			counts.cleanup += 1;
		},
		spawnDaemon: () => {
			counts.spawn += 1;
			for (const value of config.onSpawnPush ?? []) queue.push(value);
		},
		sleep: (ms) => {
			now += ms;
			return Promise.resolve();
		},
		now: () => now,
	};

	return { deps, counts };
}

describe("ensureDaemonRunning", () => {
	it("#given daemon already reachable #when ensure #then does not lock or spawn", async () => {
		const { deps, counts } = makeHarness({ probeQueue: [true], lockAvailable: true });
		await ensureDaemonRunning(PATHS, deps);
		expect(counts.spawn).toBe(0);
		expect(counts.lockAcquired).toBe(0);
	});

	it("#given not running and lock free #when ensure #then cleans stale socket, spawns, and waits", async () => {
		const { deps, counts } = makeHarness({
			probeQueue: [false, false],
			lockAvailable: true,
			onSpawnPush: [true],
		});
		await ensureDaemonRunning(PATHS, deps);
		expect(counts.cleanup).toBe(1);
		expect(counts.spawn).toBe(1);
		expect(counts.lockReleased).toBe(1);
	});

	it("#given another process holds the lock #when ensure #then waits without spawning", async () => {
		const { deps, counts } = makeHarness({
			probeQueue: [false, false, true],
			lockAvailable: false,
		});
		await ensureDaemonRunning(PATHS, deps);
		expect(counts.spawn).toBe(0);
		expect(counts.lockAcquired).toBe(0);
	});

	it("#given spawn never becomes reachable #when ensure #then throws and releases the lock", async () => {
		const { deps, counts } = makeHarness({ probeQueue: [false, false], lockAvailable: true });
		await expect(
			ensureDaemonRunning(PATHS, deps, { readyTimeoutMs: 300, pollIntervalMs: 100 }),
		).rejects.toBeInstanceOf(DaemonUnreachableError);
		expect(counts.spawn).toBe(1);
		expect(counts.lockReleased).toBe(1);
	});
});
