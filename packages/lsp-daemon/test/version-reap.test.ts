import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	attestDaemonCliProcess,
	type ReapStaleDaemonVersionsDeps,
	reapStaleDaemonVersions,
} from "../src/version-reap.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

const OWN_VERSION = "9.9.9";
const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempBase(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsp-daemon-reap-"));
	tempDirectories.push(dir);
	return dir;
}

function writeOwner(baseDir: string, version: string, pid: number): string {
	const paths = daemonTestPaths(baseDir, version);
	mkdirSync(paths.dir, { recursive: true });
	writeFileSync(
		paths.owner,
		`${JSON.stringify({
			pid,
			nonce: `nonce-${version}`,
			startedAt: new Date().toISOString(),
			endpoint: { kind: "missing", path: join(paths.dir, "daemon.sock") },
		})}\n`,
	);
	return paths.dir;
}

interface Harness {
	deps: ReapStaleDaemonVersionsDeps;
	signals: Array<{ pid: number; signal: NodeJS.Signals }>;
	logs: string[];
}

function makeHarness(overrides: {
	alive?: boolean;
	attest?: boolean;
	platform?: NodeJS.Platform;
	exitQueue?: boolean[];
}): Harness {
	const exitQueue = [...(overrides.exitQueue ?? [true])];
	const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
	const logs: string[] = [];
	const deps: ReapStaleDaemonVersionsDeps = {
		platform: overrides.platform ?? "darwin",
		isAlive: () => overrides.alive ?? true,
		attest: () => Promise.resolve(overrides.attest ?? true),
		sendSignal: (pid, signal) => {
			signals.push({ pid, signal });
			return true;
		},
		waitForExit: () => Promise.resolve(exitQueue.shift() ?? true),
		log: (message) => {
			logs.push(message);
		},
	};
	return { deps, signals, logs };
}

describe("reapStaleDaemonVersions", () => {
	it("#given an older version with a live attested daemon #when reap runs #then the daemon is terminated and its dir removed", async () => {
		const base = tempBase();
		const oldDir = writeOwner(base, "0.0.1", 4242);
		const own = daemonTestPaths(base, OWN_VERSION);
		mkdirSync(own.dir, { recursive: true });
		const { deps, signals } = makeHarness({});

		const results = await reapStaleDaemonVersions(own, deps);

		expect(results).toEqual([
			{ version: "0.0.1", status: "terminated", reason: expect.stringContaining("terminated") },
		]);
		expect(signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
		expect(existsSync(oldDir)).toBe(false);
	});

	it("#given the own version dir #when reap runs #then the own dir is never touched", async () => {
		const base = tempBase();
		const own = daemonTestPaths(base, OWN_VERSION);
		writeOwner(base, OWN_VERSION, 4242);
		const { deps, signals } = makeHarness({});

		const results = await reapStaleDaemonVersions(own, deps);

		expect(results).toEqual([]);
		expect(signals).toEqual([]);
		expect(existsSync(own.dir)).toBe(true);
	});

	it("#given a live pid that fails cmdline attestation #when reap runs #then the version is spared and a warning is logged", async () => {
		const base = tempBase();
		const oldDir = writeOwner(base, "0.0.1", 4242);
		const own = daemonTestPaths(base, OWN_VERSION);
		const { deps, signals, logs } = makeHarness({ attest: false });

		const results = await reapStaleDaemonVersions(own, deps);

		expect(results).toEqual([{ version: "0.0.1", status: "spared", reason: expect.stringContaining("attestation") }]);
		expect(signals).toEqual([]);
		expect(existsSync(oldDir)).toBe(true);
		expect(logs.some((message) => message.includes("0.0.1"))).toBe(true);
	});

	it("#given a live attested daemon on win32 #when reap runs #then the reap is deferred with a logged reason", async () => {
		const base = tempBase();
		const oldDir = writeOwner(base, "0.0.1", 4242);
		const own = daemonTestPaths(base, OWN_VERSION);
		const { deps, signals, logs } = makeHarness({ platform: "win32" });

		const results = await reapStaleDaemonVersions(own, deps);

		expect(results).toEqual([{ version: "0.0.1", status: "deferred", reason: expect.stringContaining("Windows") }]);
		expect(signals).toEqual([]);
		expect(existsSync(oldDir)).toBe(true);
		expect(logs.some((message) => message.includes("0.0.1"))).toBe(true);
	});

	it("#given an owner pid that is dead #when reap runs #then the stale dir is removed without signaling", async () => {
		const base = tempBase();
		const oldDir = writeOwner(base, "0.0.1", 4242);
		const own = daemonTestPaths(base, OWN_VERSION);
		const { deps, signals } = makeHarness({ alive: false });

		const results = await reapStaleDaemonVersions(own, deps);

		expect(results).toEqual([{ version: "0.0.1", status: "removed", reason: expect.stringContaining("dead") }]);
		expect(signals).toEqual([]);
		expect(existsSync(oldDir)).toBe(false);
	});

	it("#given a version dir without owner metadata #when reap runs #then the stale dir is removed", async () => {
		const base = tempBase();
		const staleDir = join(base, "v0.0.1");
		mkdirSync(staleDir, { recursive: true });
		const own = daemonTestPaths(base, OWN_VERSION);
		const { deps, signals } = makeHarness({});

		const results = await reapStaleDaemonVersions(own, deps);

		expect(results).toEqual([{ version: "0.0.1", status: "removed", reason: expect.stringContaining("owner") }]);
		expect(signals).toEqual([]);
		expect(existsSync(staleDir)).toBe(false);
	});

	it("#given a version dir without owner metadata but a live lock holder #when reap runs #then the dir is spared", async () => {
		const base = tempBase();
		const startingDir = join(base, "v0.0.1");
		mkdirSync(startingDir, { recursive: true });
		writeFileSync(join(startingDir, "daemon.lock"), "4242\n");
		const own = daemonTestPaths(base, OWN_VERSION);
		const { deps } = makeHarness({ alive: true });

		const results = await reapStaleDaemonVersions(own, deps);

		expect(results).toEqual([{ version: "0.0.1", status: "spared", reason: expect.stringContaining("lock") }]);
		expect(existsSync(startingDir)).toBe(true);
	});

	it("#given a daemon that survives SIGTERM #when reap runs #then it escalates to SIGKILL", async () => {
		const base = tempBase();
		const oldDir = writeOwner(base, "0.0.1", 4242);
		const own = daemonTestPaths(base, OWN_VERSION);
		const { deps, signals } = makeHarness({ exitQueue: [false, true] });

		const results = await reapStaleDaemonVersions(own, deps);

		expect(signals).toEqual([
			{ pid: 4242, signal: "SIGTERM" },
			{ pid: 4242, signal: "SIGKILL" },
		]);
		expect(results).toEqual([{ version: "0.0.1", status: "terminated", reason: expect.stringContaining("SIGKILL") }]);
		expect(existsSync(oldDir)).toBe(false);
	});

	it("#given a daemon that survives SIGKILL #when reap runs #then the reap is deferred and the dir kept", async () => {
		const base = tempBase();
		const oldDir = writeOwner(base, "0.0.1", 4242);
		const own = daemonTestPaths(base, OWN_VERSION);
		const { deps, logs } = makeHarness({ exitQueue: [false, false] });

		const results = await reapStaleDaemonVersions(own, deps);

		expect(results).toEqual([{ version: "0.0.1", status: "deferred", reason: expect.stringContaining("SIGKILL") }]);
		expect(existsSync(oldDir)).toBe(true);
		expect(logs.some((message) => message.includes("0.0.1"))).toBe(true);
	});

	it("#given a symlinked version dir #when reap runs #then the symlink is not followed", async () => {
		const base = tempBase();
		const target = join(base, "elsewhere");
		mkdirSync(target, { recursive: true });
		symlinkSync(target, join(base, "v0.0.1"));
		const own = daemonTestPaths(base, OWN_VERSION);
		const { deps, signals } = makeHarness({});

		const results = await reapStaleDaemonVersions(own, deps);

		expect(results).toEqual([]);
		expect(signals).toEqual([]);
		expect(existsSync(target)).toBe(true);
	});
});

describe("attestDaemonCliProcess", () => {
	it("#given a linux cmdline of node cli.js daemon #when attesting #then ownership is proven", async () => {
		const cmdline = Buffer.from("/usr/bin/node\u0000/opt/omo/dist/cli.js\u0000daemon\u0000");
		const result = await attestDaemonCliProcess(4242, "linux", {
			readProcFile: () => Promise.resolve(cmdline),
		});
		expect(result).toBe(true);
	});

	it("#given a linux cmdline of an unrelated process #when attesting #then ownership is rejected", async () => {
		const cmdline = Buffer.from("/usr/bin/vim\u0000file.txt\u0000");
		const result = await attestDaemonCliProcess(4242, "linux", {
			readProcFile: () => Promise.resolve(cmdline),
		});
		expect(result).toBe(false);
	});

	it("#given a darwin ps line of node cli.js daemon #when attesting #then ownership is proven", async () => {
		const result = await attestDaemonCliProcess(4242, "darwin", {
			executeForStdout: () => Promise.resolve("node /opt/omo/dist/cli.js daemon\n"),
		});
		expect(result).toBe(true);
	});

	it("#given a darwin ps line of an unrelated process #when attesting #then ownership is rejected", async () => {
		const result = await attestDaemonCliProcess(4242, "darwin", {
			executeForStdout: () => Promise.resolve("/usr/libexec/rapportd\n"),
		});
		expect(result).toBe(false);
	});

	it("#given the process table cannot be read #when attesting #then ownership is rejected", async () => {
		const result = await attestDaemonCliProcess(4242, "darwin", {
			executeForStdout: () => Promise.resolve(null),
		});
		expect(result).toBe(false);
	});

	it("#given win32 #when attesting #then ownership cannot be proven", async () => {
		const result = await attestDaemonCliProcess(4242, "win32");
		expect(result).toBe(false);
	});
});
