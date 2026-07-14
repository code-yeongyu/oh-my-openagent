import { spawnSync } from "node:child_process";
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

	it("#given daemon probing is pending #when startup is aborted #then ensure settles without spawning", async () => {
		const controller = new AbortController();
		const probeStarted = deferred();
		const probeRelease = deferred();
		let probeCount = 0;
		let spawnCount = 0;
		let observedSignal: AbortSignal | undefined;
		const deps: EnsureDaemonDeps = {
			probe: async (_paths, signal?: AbortSignal) => {
				probeCount += 1;
				observedSignal = signal;
				if (probeCount !== 1) return true;
				probeStarted.resolve();
				await probeRelease.promise;
				return false;
			},
			spawnDaemon: () => {
				spawnCount += 1;
			},
			sleep: () => Promise.resolve(),
			now: () => 0,
		};
		const ensure = ensureDaemonRunning(PATHS, deps, { signal: controller.signal });
		await probeStarted.promise;

		controller.abort();
		const settledBeforeProbeRelease = await settlesWithin(ensure, 100);
		probeRelease.resolve();
		const outcome = await ensure.then(
			() => null,
			(error: unknown) => error,
		);

		expect(settledBeforeProbeRelease).toBe(true);
		expect(outcome).toBeInstanceOf(Error);
		if (!(outcome instanceof Error)) throw new Error("ensure did not reject with an Error");
		expect(outcome.name).toBe("AbortError");
		expect(probeCount).toBe(1);
		expect(spawnCount).toBe(0);
		expect(observedSignal).toBe(controller.signal);
	});

	it("#given a probe is already aborted #when its socket cannot connect #then the socket error stays contained", async () => {
		const moduleUrl = new URL("../src/ensure-daemon.ts", import.meta.url).href;
		const script = `
			import { pingDaemon } from ${JSON.stringify(moduleUrl)};
			const controller = new AbortController();
			controller.abort();
			let uncaughtError;
			process.once("uncaughtException", (error) => { uncaughtError = error; });
			const value = await pingDaemon({ socket: ${JSON.stringify(PATHS.socket)} }, "test-token", 100, controller.signal);
			await new Promise((resolve) => setImmediate(resolve));
			if (value !== null) throw new Error("aborted ping returned a daemon owner");
			if (uncaughtError) throw uncaughtError;
		`;

		const child = spawnSync("bun", ["--eval", script], { encoding: "utf8" });

		expect(child.status, child.stderr).toBe(0);
	});
});

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: () => resolvePromise?.() };
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => true,
			),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs);
				timer.unref();
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
