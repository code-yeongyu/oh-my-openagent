import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { sweepCodegraphZombies } from "../../../../../utils/src/process-sweep/index.ts";
import { executeCodegraphSessionStartHook, type WorkerSpawnInvocation } from "../src/hook.ts";
import { sweepOmoFamiliesBestEffort } from "../src/hook-sweep.ts";

describe("CodeGraph SessionStart zombie sweep", () => {
	it("#given a normal packaged LSP runtime without an env override #when helper families sweep #then the packaged daemon version is active", async () => {
		// given
		const pluginRoot = mkdtempSync(join(tmpdir(), "omo-packaged-lsp-version-"));
		const daemonDist = join(pluginRoot, "components", "lsp-daemon", "dist");
		mkdirSync(daemonDist, { recursive: true });
		writeFileSync(
			join(daemonDist, "package.json"),
			JSON.stringify({ name: "@code-yeongyu/lsp-daemon", version: "0.1.0" }),
		);
		const activeVersions: (string | undefined)[] = [];
		const sweeps = {
			sweepCodegraph: () => undefined,
			sweepGitBashProxies: () => undefined,
			sweepLspProxies: () => undefined,
			sweepStaleLspDaemons: (options: { readonly currentVersion?: string }) => {
				activeVersions.push(options.currentVersion);
			},
		};

		try {
			// when
			await sweepOmoFamiliesBestEffort(
				{ env: {}, homeDir: pluginRoot, pluginRoot },
				sweeps,
			);
			await sweepOmoFamiliesBestEffort(
				{ env: { OMO_LSP_DAEMON_VERSION: "9.9.9" }, homeDir: pluginRoot, pluginRoot },
				sweeps,
			);
			writeFileSync(
				join(daemonDist, "package.json"),
				JSON.stringify({ name: "@code-yeongyu/lsp-daemon", version: "invalid version" }),
			);
			await sweepOmoFamiliesBestEffort(
				{ env: {}, homeDir: pluginRoot, pluginRoot },
				sweeps,
			);

			// then
			expect(activeVersions).toEqual(["0.1.0", "9.9.9", undefined]);
		} finally {
			rmSync(pluginRoot, { force: true, recursive: true });
		}
	});

	it("#given the zombie sweep fails #when SessionStart fires #then the hook still exits zero", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		let sweepCalls = 0;

		// when
		const result = await executeCodegraphSessionStartHook({
			config: { codegraph: { enabled: false }, sources: [], warnings: [] },
			env: { HOME: "/tmp/home" },
			stdin: Readable.from(["{}"]),
			stdout: { write: (chunk) => stdout.push(chunk) },
			spawnWorker: (invocation) => spawned.push(invocation),
			sweepZombies: () => {
				sweepCalls += 1;
				throw new Error("ps unavailable");
			},
		});

		// then
		expect(result).toEqual({ action: "skipped-disabled", exitCode: 0 });
		expect(sweepCalls).toBe(1);
		expect(spawned).toEqual([]);
		expect(stdout.join("")).toBe("");
	});

	it("#given CodeGraph is disabled #when SessionStart repeats #then shared helper families still sweep without spawning workers", async () => {
		// given
		const familyCalls: string[] = [];
		const options = {
			config: { codegraph: { enabled: false }, sources: [], warnings: [] },
			env: { HOME: "/tmp/home" },
			spawnWorker: () => {
				throw new Error("disabled CodeGraph must not spawn a worker");
			},
			sweepFamilies: {
				sweepCodegraph: () => familyCalls.push("codegraph"),
				sweepGitBashProxies: () => familyCalls.push("git-bash-proxy"),
				sweepLspProxies: () => familyCalls.push("lsp-proxy"),
				sweepStaleLspDaemons: () => {
					familyCalls.push("lsp-daemon");
					throw new Error("stale-version scan unavailable");
				},
			},
		} as const;

		// when
		const first = await executeCodegraphSessionStartHook({ ...options, stdin: Readable.from(["{}"]) });
		const second = await executeCodegraphSessionStartHook({ ...options, stdin: Readable.from(["{}"]) });

		// then
		expect(first).toEqual({ action: "skipped-disabled", exitCode: 0 });
		expect(second).toEqual({ action: "skipped-disabled", exitCode: 0 });
		expect(familyCalls.sort()).toEqual([
			"codegraph",
			"codegraph",
			"git-bash-proxy",
			"git-bash-proxy",
			"lsp-daemon",
			"lsp-daemon",
			"lsp-proxy",
			"lsp-proxy",
		]);
	});

	it("#given orphaned and active Windows CodeGraph helpers #when disabled SessionStart repeats #then the orphan is reaped once and the active helper remains", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codex-startup-sweep-"));
		const root = "C:\\Users\\runner\\.codex\\plugins\\cache\\sisyphuslabs\\omo\\4.19.4";
		let processes = [
			{ command: `node ${root}\\components\\codegraph\\dist\\serve.js`, pid: 4101, ppid: 9999 },
			{ command: `node ${root}\\components\\codegraph\\dist\\serve.js`, pid: 4102, ppid: 5000 },
			{ command: "codex app-server", pid: 5000, ppid: 1 },
		];
		const terminated: number[] = [];
		const sweepZombies = (sweepOptions: Parameters<typeof sweepCodegraphZombies>[0]) => sweepCodegraphZombies({
			...sweepOptions,
			force: true,
			graceMs: 0,
			killer: {
				isAlive: (pid) => processes.some((processInfo) => processInfo.pid === pid),
				kill: (pid) => {
					processes = processes.filter((processInfo) => processInfo.pid !== pid);
					return Promise.resolve();
				},
				terminate: (pid) => {
					terminated.push(pid);
					processes = processes.filter((processInfo) => processInfo.pid !== pid);
					return Promise.resolve();
				},
			},
			ownedRoots: [root],
			platform: "win32",
			processProvider: () => Promise.resolve(processes),
		});

		try {
			// when
			await executeCodegraphSessionStartHook({
				config: { codegraph: { enabled: false }, sources: [], warnings: [] },
				env: { HOME: homeDir },
				stdin: Readable.from(["{}"]),
				sweepZombies,
			});
			await executeCodegraphSessionStartHook({
				config: { codegraph: { enabled: false }, sources: [], warnings: [] },
				env: { HOME: homeDir },
				stdin: Readable.from(["{}"]),
				sweepZombies,
			});

			// then
			expect(terminated).toEqual([4101]);
			expect(processes.map(({ pid }) => pid)).toEqual([4102, 5000]);
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});
});
