import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { runCodegraphCli } from "../src/cli.ts";
import {
	executeCodegraphSessionStartHook,
	resolveCodegraphCommandInvocation,
	runCodegraphSessionStartWorker,
	type WorkerSpawnInvocation,
} from "../src/hook.ts";

const pluginRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const hooksConfigPath = resolve(pluginRoot, "hooks/hooks.json");

describe("CodeGraph SessionStart hook", () => {
	it("#given hook session-start cli args #when invoked with empty JSON input #then it emits valid JSON and exits zero", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-hook-home-"));
		try {
			// when
			const exitCode = await runCodegraphCli({
				argv: ["node", "cli.js", "hook", "session-start"],
				cwd: mkdtempSync(join(tmpdir(), "omo-codegraph-hook-workspace-")),
				env: { HOME: homeDir },
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
			});

			// then
			expect(exitCode).toBe(0);
			expect(spawned).toHaveLength(1);
			const parsed = JSON.parse(stdout.join(""));
			expect(parsed).toEqual({
				hookSpecificOutput: {
					hookEventName: "SessionStart",
					additionalContext: "LazyCodex CodeGraph bootstrap scheduled in background",
				},
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given CodeGraph is disabled by Codex SOT config #when SessionStart fires #then it skips without spawning", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];

		// when
		const result = await executeCodegraphSessionStartHook({
			config: { codegraph: { enabled: false }, sources: [], warnings: [] },
			env: {},
			stdin: Readable.from(["{}"]),
			stdout: { write: (chunk) => stdout.push(chunk) },
			spawnWorker: (invocation) => spawned.push(invocation),
		});

		// then
		expect(result).toEqual({ action: "skipped-disabled", exitCode: 0 });
		expect(spawned).toEqual([]);
		expect(stdout.join("")).toBe("");
	});

	it("#given HOME OMO config disables Codex CodeGraph #when SessionStart fires #then it skips without spawning", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-sot-home-"));
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-sot-workspace-"));
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		try {
			mkdirSync(join(homeDir, ".omo"), { recursive: true });
			writeFileSync(
				join(homeDir, ".omo", "config.jsonc"),
				'{ "codegraph": { "enabled": true }, "[codex]": { "codegraph": { "enabled": false } } }\n',
			);

			// when
			const result = await executeCodegraphSessionStartHook({
				cwd: workspace,
				env: { HOME: homeDir },
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
			});

			// then
			expect(result).toEqual({ action: "skipped-disabled", exitCode: 0 });
			expect(spawned).toEqual([]);
			expect(stdout.join("")).toBe("");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given project Codex SOT disables global CodeGraph enablement #when SessionStart fires #then project config wins", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-project-sot-home-"));
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-project-sot-workspace-"));
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		try {
			mkdirSync(join(homeDir, ".omo"), { recursive: true });
			mkdirSync(join(workspace, ".omo"), { recursive: true });
			writeFileSync(join(homeDir, ".omo", "config.jsonc"), '{ "codegraph": { "enabled": true } }\n');
			writeFileSync(join(workspace, ".omo", "config.jsonc"), '{ "[codex]": { "codegraph": { "enabled": false } } }\n');

			// when
			const result = await executeCodegraphSessionStartHook({
				cwd: workspace,
				env: { HOME: homeDir },
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
			});

			// then
			expect(result).toEqual({ action: "skipped-disabled", exitCode: 0 });
			expect(spawned).toEqual([]);
			expect(stdout.join("")).toBe("");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given env disables CodeGraph over SOT enablement #when SessionStart fires #then it skips without spawning", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-env-home-"));
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		try {
			mkdirSync(join(homeDir, ".omo"), { recursive: true });
			writeFileSync(join(homeDir, ".omo", "config.jsonc"), '{ "codegraph": { "enabled": true } }\n');

			// when
			const result = await executeCodegraphSessionStartHook({
				env: { CODEX_CODEGRAPH_ENABLED: "0", HOME: homeDir },
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
			});

			// then
			expect(result).toEqual({ action: "skipped-disabled", exitCode: 0 });
			expect(spawned).toEqual([]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given CodeGraph is enabled #when SessionStart fires #then it detaches a background worker immediately", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-workspace-"));

		try {
			// when
			const result = await executeCodegraphSessionStartHook({
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: "/tmp/home", KEEP: "1" },
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
				workerCliPath: "/plugin/components/codegraph/dist/cli.js",
			});

			// then
			expect(result).toEqual({ action: "spawned", exitCode: 0 });
			expect(spawned).toEqual([
				{
					args: ["/plugin/components/codegraph/dist/cli.js", "hook", "session-start-worker"],
					command: process.execPath,
					env: {
						HOME: "/tmp/home",
						KEEP: "1",
						OMO_CODEGRAPH_SESSION_START_CWD: workspace,
					},
				},
			]);
			expect(JSON.parse(stdout.join(""))).toEqual({
				hookSpecificOutput: {
					additionalContext: "LazyCodex CodeGraph bootstrap scheduled in background",
					hookEventName: "SessionStart",
				},
			});
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given an unsupported local Node and a PATH CodeGraph command #when worker runs #then it skips without touching the workspace", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-node-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-node-home-"));
		const outcomes: unknown[] = [];

		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				cwd: workspace,
				env: { HOME: homeDir },
				nodeVersion: "26.3.0",
				logOutcome: (outcome) => outcomes.push(outcome),
				deps: {
					resolveCommand: () => {
						return { argsPrefix: [], command: "/usr/local/bin/codegraph", exists: true, source: "path" };
					},
					ensureProvisioned: () => {
						throw new Error("ensureProvisioned should not run on unsupported Node");
					},
					prepareWorkspace: () => {
						throw new Error("prepareWorkspace should not run on unsupported Node");
					},
					runCommand: () => {
						throw new Error("runCommand should not run on unsupported Node");
					},
				},
			});

			// then
			expect(result).toEqual({ action: "skipped-unsupported-node" });
			expect(existsSync(join(workspace, ".codegraph"))).toBe(false);
			expect(outcomes).toEqual([{ action: "skipped-unsupported-node", projectRoot: workspace }]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given an unsupported local Node but bundled CodeGraph resolves through CODEGRAPH_NODE_BIN #when worker runs #then it bootstraps with the compatible runtime", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-compatible-node-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-compatible-node-home-"));
		const nodeBin = "/opt/node22/bin/node";
		const calls: Array<{ readonly args: readonly string[]; readonly command: string }> = [];
		const outcomes: unknown[] = [];

		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				cwd: workspace,
				env: { CODEGRAPH_NODE_BIN: nodeBin, HOME: homeDir },
				nodeVersion: "26.3.0",
				logOutcome: (outcome) => outcomes.push(outcome),
				deps: {
					ensureGitignored: () => true,
					ensureProvisioned: () => {
						throw new Error("provisioning should not run when bundled CodeGraph resolved");
					},
					prepareWorkspace: () => ({
						dataDir: join(homeDir, ".omo/codegraph/projects/test"),
						dataRoot: join(homeDir, ".omo/codegraph"),
						linked: true,
						mode: "global-linked",
						projectLink: join(workspace, ".codegraph"),
					}),
					resolveCommand: () => ({ argsPrefix: ["codegraph.js"], command: nodeBin, exists: true, source: "bundled" }),
					runCommand: (_projectRoot, command, args) => {
						calls.push({ args, command });
						return Promise.resolve({ exitCode: 0, stdout: calls.length === 1 ? '{"initialized":false}' : "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "initialized" });
			expect(calls).toEqual([
				{ args: ["codegraph.js", "status", "--json"], command: nodeBin },
				{ args: ["codegraph.js", "init"], command: nodeBin },
			]);
			expect(outcomes).toEqual([{ action: "initialized", exitCode: 0, projectRoot: workspace, source: "bundled", timedOut: false }]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given CodeGraph cannot be resolved or provisioned #when worker runs #then it logs a graceful skip", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-home-"));
		const outcomes: unknown[] = [];
		const calls: string[] = [];

		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				cwd: workspace,
				env: { HOME: homeDir },
				nodeVersion: "22.14.0",
				logOutcome: (outcome) => outcomes.push(outcome),
				deps: {
					ensureGitignored: () => {
						calls.push("ensureGitignored");
						return true;
					},
					ensureProvisioned: () => Promise.resolve({ error: "offline", provisioned: false }),
					prepareWorkspace: () => {
						calls.push("prepareWorkspace");
						return {
							dataDir: join(homeDir, ".omo/codegraph/projects/test"),
							dataRoot: join(homeDir, ".omo/codegraph"),
							linked: true,
							mode: "global-linked",
							projectLink: join(workspace, ".codegraph"),
						};
					},
					resolveCommand: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
					runCommand: () => {
						calls.push("runCommand");
						return Promise.resolve({ exitCode: 0, stdout: "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "skipped-unavailable" });
			expect(calls).toEqual([]);
			expect(outcomes).toEqual([
				{
					action: "skipped-unavailable",
					error: "offline",
					projectRoot: workspace,
					source: "path",
				},
			]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given CodeGraph is unavailable and auto provisioning is disabled #when worker runs #then it leaves the project untouched", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-unavailable-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-unavailable-home-"));
		const outcomes: unknown[] = [];

		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { auto_provision: false, enabled: true }, sources: [], warnings: [] },
				nodeVersion: "22.14.0",
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: (outcome) => outcomes.push(outcome),
				deps: {
					ensureProvisioned: () => {
						throw new Error("auto provision should not run");
					},
					resolveCommand: () => ({ argsPrefix: [], command: "missing-codegraph", exists: false, source: "path" }),
					runCommand: () => {
						throw new Error("codegraph command should not run");
					},
				},
			});

			// then
			expect(result).toEqual({ action: "skipped-unavailable" });
			expect(existsSync(join(workspace, ".codegraph"))).toBe(false);
			expect(existsSync(join(workspace, ".git", "info", "exclude"))).toBe(false);
			expect(outcomes).toEqual([
				{
					action: "skipped-unavailable",
					error: "codegraph binary unavailable and auto_provision is disabled",
					projectRoot: workspace,
					source: "path",
				},
			]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given Windows install_dir has codegraph.cmd #when worker resolves provisioned CodeGraph #then it uses the cmd shim", async () => {
		await withProcessPlatform("win32", async () => {
			// given
			const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-win32-"));
			const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-win32-home-"));
			const installDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-win32-install-"));
			const binPath = join(installDir, "bin", "codegraph.cmd");
			const calls: { readonly args: readonly string[]; readonly command: string; readonly env: Record<string, string> }[] = [];
			const outcomes: unknown[] = [];
			try {
				mkdirSync(join(installDir, "bin"), { recursive: true });
				writeFileSync(binPath, "");

				// when
				const result = await runCodegraphSessionStartWorker({
					config: { codegraph: { enabled: true, install_dir: installDir }, sources: [], warnings: [] },
					nodeVersion: "22.14.0",
					cwd: workspace,
					env: { HOME: homeDir },
					logOutcome: (outcome) => outcomes.push(outcome),
					deps: {
						ensureGitignored: () => true,
						ensureProvisioned: () => {
							throw new Error("provisioning should not run when install_dir binary exists");
						},
						prepareWorkspace: () => ({
							dataDir: join(homeDir, ".omo/codegraph/projects/test"),
							dataRoot: join(homeDir, ".omo/codegraph"),
							linked: true,
							mode: "global-linked",
							projectLink: join(workspace, ".codegraph"),
						}),
						resolveCommand: (options) => {
							const provisioned = options?.provisioned?.() ?? null;
							return { argsPrefix: [], command: provisioned ?? "missing-codegraph", exists: provisioned !== null, source: provisioned === null ? "path" : "provisioned" };
						},
						runCommand: (_projectRoot, command, args, options) => {
							calls.push({ args, command, env: options.env });
							return Promise.resolve({ exitCode: 0, stdout: calls.length === 1 ? '{"initialized":false}' : "", timedOut: false });
						},
					},
				});

				// then
				expect(result).toEqual({ action: "initialized" });
				expect(calls.map((call) => ({ args: [...call.args], command: call.command }))).toEqual([
					{ args: ["status", "--json"], command: binPath },
					{ args: ["init"], command: binPath },
				]);
				expect(calls[0]?.env["CODEGRAPH_INSTALL_DIR"]).toBe(installDir);
				expect(outcomes).toEqual([{ action: "initialized", exitCode: 0, projectRoot: workspace, source: "provisioned", timedOut: false }]);
			} finally {
				rmSync(workspace, { recursive: true, force: true });
				rmSync(homeDir, { recursive: true, force: true });
				rmSync(installDir, { recursive: true, force: true });
			}
		});
	});

	it("#given Windows codegraph.cmd #when default worker runner builds invocation #then it runs through cmd.exe", () => {
		// given
		const command = "C:\\Users\\test\\.omo\\codegraph\\bin\\codegraph.cmd";

		// when
		const invocation = resolveCodegraphCommandInvocation(command, ["status", "--json"], "win32");

		// then
		expect(invocation).toEqual({
			args: ["/d", "/s", "/c", command, "status", "--json"],
			command: "cmd.exe",
		});
	});

	it("#given non-Windows codegraph command #when default worker runner builds invocation #then it executes directly", () => {
		// given
		const command = "/home/test/.omo/codegraph/bin/codegraph";

		// when
		const invocation = resolveCodegraphCommandInvocation(command, ["sync"], "linux");

		// then
		expect(invocation).toEqual({ args: ["sync"], command });
	});

	it("#given resolved CodeGraph status #when worker runs #then it runs status before init or sync", async () => {
		for (const scenario of [
			{ action: "initialized", args: [["status", "--json"], ["init"]], stdout: '{"initialized":false}' },
			{ action: "synced", args: [["status", "--json"], ["sync"]], stdout: '{"initialized":true}' },
		] as const) {
			// given
			const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-status-"));
			const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-status-home-"));
			const calls: { readonly args: readonly string[]; readonly command: string; readonly env: Record<string, string> }[] = [];
			const outcomes: unknown[] = [];
			try {
				// when
				const result = await runCodegraphSessionStartWorker({
					config: { codegraph: { enabled: true, install_dir: "/tmp/codegraph-install" }, sources: [], warnings: [] },
					nodeVersion: "22.14.0",
					cwd: workspace,
					env: { HOME: homeDir },
					logOutcome: (outcome) => outcomes.push(outcome),
					deps: {
						ensureGitignored: () => true,
						ensureProvisioned: () => Promise.resolve({ binPath: "/tmp/codegraph", provisioned: true }),
						prepareWorkspace: () => ({
							dataDir: join(homeDir, ".omo/codegraph/projects/test"),
							dataRoot: join(homeDir, ".omo/codegraph"),
							linked: true,
							mode: "global-linked",
							projectLink: join(workspace, ".codegraph"),
						}),
						resolveCommand: () => ({ argsPrefix: [], command: "/tmp/codegraph", exists: true, source: "path" }),
						runCommand: (_projectRoot, command, args, options) => {
							calls.push({ args, command, env: options.env });
							return Promise.resolve({ exitCode: 0, stdout: calls.length === 1 ? scenario.stdout : "", timedOut: false });
						},
					},
				});

				// then
				expect(result).toEqual({ action: scenario.action });
				expect(calls.map((call) => [...call.args])).toEqual(scenario.args.map((args) => [...args]));
				expect(calls[0]?.env["CODEGRAPH_INSTALL_DIR"]).toBe("/tmp/codegraph-install");
				expect(outcomes).toEqual([{ action: scenario.action, exitCode: 0, projectRoot: workspace, source: "path", timedOut: false }]);
			} finally {
				rmSync(workspace, { recursive: true, force: true });
				rmSync(homeDir, { recursive: true, force: true });
			}
		}
	});

	it("#given malformed hook input with CodeGraph disabled #when SessionStart fires #then it stays silent and exits zero", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];

		// when
		const result = await executeCodegraphSessionStartHook({
			config: { codegraph: { enabled: false }, sources: [], warnings: [] },
			env: {},
			stdin: Readable.from(["{not-json"]),
			stdout: { write: (chunk) => stdout.push(chunk) },
			spawnWorker: (invocation) => spawned.push(invocation),
		});

		// then
		expect(result.exitCode).toBe(0);
		expect(spawned).toEqual([]);
		expect(stdout.join("")).toBe("");
	});

	it("#given plugin hook config #when inspected #then CodeGraph is registered after bootstrap SessionStart", () => {
		// given
		const hooksConfig = JSON.parse(readFileSync(hooksConfigPath, "utf8"));

		// when
		const sessionStartHooks = hooksConfig.hooks.SessionStart;
		const commands = sessionStartHooks.map((entry: { readonly hooks: readonly [{ readonly command: string }] }) => {
			return entry.hooks[0].command;
		});

		// then
		expect(commands).toContain('node "${PLUGIN_ROOT}/components/codegraph/dist/cli.js" hook session-start');
		expect(commands.indexOf('node "${PLUGIN_ROOT}/components/bootstrap/dist/cli.js" hook session-start')).toBeLessThan(
			commands.indexOf('node "${PLUGIN_ROOT}/components/codegraph/dist/cli.js" hook session-start'),
		);
	});
});

async function withProcessPlatform(platform: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { configurable: true, enumerable: true, value: platform });
	try {
		await run();
	} finally {
		if (descriptor !== undefined) Object.defineProperty(process, "platform", descriptor);
	}
}
