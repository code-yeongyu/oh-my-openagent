import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { runCodegraphCli } from "../src/cli.ts";
import {
	executeCodegraphSessionStartHook,
	runCodegraphPostToolUseHook,
	type WorkerSpawnInvocation,
} from "../src/hook.ts";

const pluginRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const pluginConfigPath = resolve(pluginRoot, ".codex-plugin/plugin.json");

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

	it("#given CodeGraph MCP reports an uninitialized project #when PostToolUse fires #then it emits OMO global-store init guidance", async () => {
		// given
		const output = runCodegraphPostToolUseHook(
			{
				cwd: "/Users/me/project",
				tool_name: "codegraph.codegraph_status",
				tool_response: {
					error: [
						"Tool execution failed: CodeGraph not initialized in /Users/me/project.",
						"Run 'codegraph init' in that project first.",
					].join(" "),
				},
			},
			{ homeDir: "/Users/me" },
		);

		// when
		const parsed = JSON.parse(output);

		// then
		expect(parsed).toEqual({
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: expect.stringContaining('"/Users/me/.omo/codegraph/projects/project-'),
			},
		});
		expect(parsed.hookSpecificOutput.additionalContext).toContain('run `codegraph init` from "/Users/me/project"');
	});

	it("#given real CodeGraph status output has no MCP path phrase #when PostToolUse fires #then it emits OMO global-store init guidance", async () => {
		// given
		const output = runCodegraphPostToolUseHook(
			{
				cwd: "/Users/me/project",
				tool_name: "mcp__codegraph__codegraph_status",
				tool_response: ['Project: /Users/me/project', "Not initialized", 'Run "codegraph init" to initialize'].join("\n"),
			},
			{ homeDir: "/Users/me" },
		);

		// when
		const parsed = JSON.parse(output);

		// then
		expect(parsed.hookSpecificOutput.additionalContext).toContain('CodeGraph is not initialized for "/Users/me/project"');
		expect(parsed.hookSpecificOutput.additionalContext).toContain('"/Users/me/.omo/codegraph/projects/project-');
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
		const pluginConfig: unknown = JSON.parse(readFileSync(pluginConfigPath, "utf8"));

		// when
		const hookPaths =
			typeof pluginConfig === "object" && pluginConfig !== null && "hooks" in pluginConfig && Array.isArray(pluginConfig.hooks)
				? pluginConfig.hooks.filter((hookPath): hookPath is string => typeof hookPath === "string")
				: [];

		// then
		expect(hookPaths).toContain("./hooks/session-start-checking-codegraph-bootstrap.json");
		expect(hookPaths.indexOf("./hooks/session-start-checking-bootstrap-provisioning.json")).toBeLessThan(
			hookPaths.indexOf("./hooks/session-start-checking-codegraph-bootstrap.json"),
		);
	});
});
