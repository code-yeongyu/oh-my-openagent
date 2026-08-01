import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CODEGRAPH_PINNED_VERSION } from "../../../../../utils/src/codegraph/manifest.ts";
import { resolveCodegraphCommandInvocation, runCodegraphSessionStartWorker } from "../src/hook.ts";

function writeProjectDatabase(workspace: string): void {
	mkdirSync(join(workspace, ".codegraph"), { recursive: true });
	writeFileSync(join(workspace, ".codegraph", "codegraph.db"), "fixture");
}

describe("CodeGraph SessionStart worker flow", () => {
	it("#given install_dir has the pinned platform binary #when worker resolves provisioned CodeGraph #then it uses that launcher", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-platform-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-platform-home-"));
		const installDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-platform-install-"));
		const binPath = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph");
		const calls: { readonly args: readonly string[]; readonly command: string; readonly env: Record<string, string> }[] = [];
		const outcomes: unknown[] = [];
		try {
			mkdirSync(join(installDir, "bin"), { recursive: true });
			mkdirSync(join(installDir, ".provisioned"), { recursive: true });
			writeFileSync(binPath, "");
			writeFileSync(
				join(installDir, ".provisioned", `codegraph-${CODEGRAPH_PINNED_VERSION}.json`),
				`${JSON.stringify({ binPath, version: CODEGRAPH_PINNED_VERSION })}\n`,
			);

			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { enabled: true, install_dir: installDir }, sources: [], trustedCodegraphInstallDir: installDir, warnings: [] },
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
					resolveManagedBin: () => binPath,
					runCommand: (_projectRoot, command, args, options) => {
						calls.push({ args, command, env: options.env });
						writeProjectDatabase(workspace);
						return Promise.resolve({ exitCode: 0, stdout: "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "initialized" });
			expect(calls.map((call) => ({ args: [...call.args], command: call.command }))).toEqual([
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

	it("#given Windows codegraph.cmd #when default worker runner builds invocation #then it runs through cmd.exe", () => {
		// given
		const command = "C:\\Users\\test\\.omo\\codegraph\\bin\\codegraph.cmd";

		// when
		const invocation = resolveCodegraphCommandInvocation(command, ["init"], "win32");

		// then
		expect(invocation).toEqual({
			args: ["/d", "/s", "/c", command, "init"],
			command: "cmd.exe",
		});
	});

	it("#given Windows CodeGraph resolves to a Node script #when default worker runner builds invocation #then Node executes it", () => {
		// given
		const command = "C:\\Users\\test\\.omo\\codegraph\\bin\\codegraph.cjs";

		// when
		const invocation = resolveCodegraphCommandInvocation(command, ["init"], "win32");

		// then
		expect(invocation).toEqual({
			args: [command, "init"],
			command: process.execPath,
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

	it("#given an uninitialized exact project #when worker runs #then it invokes init directly without a status command", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-init-direct-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-init-direct-home-"));
		const calls: { readonly args: readonly string[]; readonly env: Record<string, string> }[] = [];
		const outcomes: unknown[] = [];
		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { enabled: true, install_dir: "/tmp/codegraph-install" }, sources: [], trustedCodegraphInstallDir: "/tmp/codegraph-install", warnings: [] },
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
					runCommand: (_projectRoot, _command, args, options) => {
						calls.push({ args, env: options.env });
						writeProjectDatabase(workspace);
						return Promise.resolve({ exitCode: 0, stdout: "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "initialized" });
			expect(calls.map((call) => [...call.args])).toEqual([["init"]]);
			expect(calls[0]?.env["CODEGRAPH_INSTALL_DIR"]).toBe("/tmp/codegraph-install");
			expect(outcomes).toEqual([{ action: "initialized", exitCode: 0, projectRoot: workspace, source: "path", timedOut: false }]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given codegraph.daemon=true #when the indexing worker runs #then its env stays daemon-less with CODEGRAPH_NO_DAEMON=1", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-daemon-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-daemon-home-"));
		const calls: { readonly args: readonly string[]; readonly command: string; readonly env: Record<string, string> }[] = [];
		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { daemon: true, enabled: true, install_dir: "/tmp/codegraph-install" }, sources: [], trustedCodegraphInstallDir: "/tmp/codegraph-install", warnings: [] },
				nodeVersion: "22.14.0",
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: () => undefined,
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
						writeProjectDatabase(workspace);
						return Promise.resolve({ exitCode: 0, stdout: "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "initialized" });
			expect(calls.length).toBeGreaterThan(0);
			for (const call of calls) {
				expect(call.env["CODEGRAPH_NO_DAEMON"]).toBe("1");
			}
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given ambient provider tokens #when default worker runner spawns CodeGraph #then child env only gets safe and controlled variables", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-env-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-env-home-"));
		const logPath = join(homeDir, "child-env.jsonl");
		const originalOpenAiKey = process.env["OPENAI_API_KEY"];
		process.env["OPENAI_API_KEY"] = "sk-test-secret";

		try {
			const fakeCodegraphScript = [
				"const fs = require('node:fs');",
				`fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({install:process.env.CODEGRAPH_INSTALL_DIR,openai:process.env.OPENAI_API_KEY}) + '\\n');`,
				"fs.mkdirSync('.codegraph', { recursive: true });",
				"fs.writeFileSync('.codegraph/codegraph.db', 'fixture');",
			].join("");

			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: () => undefined,
				nodeVersion: "22.14.0",
				deps: {
					ensureGitignored: () => true,
					ensureProvisioned: () => {
						throw new Error("provisioning should not run when command is resolved");
					},
					prepareWorkspace: () => ({
						dataDir: join(homeDir, ".omo/codegraph/projects/test"),
						dataRoot: join(homeDir, ".omo/codegraph"),
						linked: true,
						mode: "global-linked",
						projectLink: join(workspace, ".codegraph"),
					}),
					resolveCommand: () => ({ argsPrefix: ["-e", fakeCodegraphScript], command: process.execPath, exists: true, source: "bundled" }),
				},
			});

			// then
			expect(result).toEqual({ action: "initialized" });
			const captured = readFileSync(logPath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(captured).toEqual([{ install: join(homeDir, ".omo", "codegraph") }]);
		} finally {
			if (originalOpenAiKey === undefined) delete process.env["OPENAI_API_KEY"];
			else process.env["OPENAI_API_KEY"] = originalOpenAiKey;
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
