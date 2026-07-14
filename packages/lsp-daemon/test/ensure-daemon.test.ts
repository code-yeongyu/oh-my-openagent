import { describe, expect, it } from "vitest";

import { DaemonUnreachableError, type EnsureDaemonDeps, ensureDaemonRunning } from "../src/ensure-daemon.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

const PATHS = daemonTestPaths("/tmp/ensure-test", "9.9.9");

interface Harness {
	deps: EnsureDaemonDeps;
	counts: { spawn: number };
}

function makeHarness(config: { probeQueue: boolean[]; onSpawnPush?: boolean[] }): Harness {
	const queue = [...config.probeQueue];
	const counts = { spawn: 0 };
	let now = 0;

	const deps: EnsureDaemonDeps = {
		probe: () => Promise.resolve(queue.shift() ?? false),
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
		const { deps, counts } = makeHarness({ probeQueue: [true] });
		await ensureDaemonRunning(PATHS, deps);
		expect(counts.spawn).toBe(0);
	});

	it("#given not running #when ensure #then spawns without owning the daemon lock and waits", async () => {
		const { deps, counts } = makeHarness({
			probeQueue: [false, false],
			onSpawnPush: [true],
		});
		await ensureDaemonRunning(PATHS, deps);
		expect(counts.spawn).toBe(1);
	});

	it("#given another candidate wins after spawn #when ensure #then authenticated polling observes it", async () => {
		const { deps, counts } = makeHarness({
			probeQueue: [false, false, true],
		});
		await ensureDaemonRunning(PATHS, deps);
		expect(counts.spawn).toBe(1);
	});

	it("#given spawn never becomes reachable #when ensure #then throws", async () => {
		const { deps, counts } = makeHarness({ probeQueue: [false, false] });
		await expect(
			ensureDaemonRunning(PATHS, deps, { readyTimeoutMs: 300, pollIntervalMs: 100 }),
		).rejects.toBeInstanceOf(DaemonUnreachableError);
		expect(counts.spawn).toBe(1);
	});
});
