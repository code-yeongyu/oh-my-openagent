import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { daemonTestPaths } from "./daemon-path-fixture.js";

const directories: string[] = [];
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

afterEach(() => {
	for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function runCli(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
	const child = spawn("bun", [cli, "daemon"], {
		env: { ...process.env, ...env, BUN_BE_BUN: "1" },
		stdio: ["ignore", "ignore", "pipe"],
	});
	let stderr = "";
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
	try {
		return await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code) => resolve({ code, stderr }));
		});
	} finally {
		clearTimeout(timer);
	}
}

describe("daemon CLI error output", () => {
	it("prints a deferred startup as one line without a stack", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lsp-cli-deferred-"));
		directories.push(dir);
		const paths = daemonTestPaths(dir, "cli-test");
		mkdirSync(paths.dir, { recursive: true });
		writeFileSync(paths.lock, `${process.pid}\n`);
		const result = await runCli({
			OMO_LSP_DAEMON_DIR: dir,
			OMO_LSP_DAEMON_CLI: cli,
			OMO_LSP_DAEMON_VERSION: "cli-test",
		});
		expect(result.code).toBe(1);
		expect(result.stderr.trim().split("\n")).toHaveLength(1);
		expect(result.stderr).toContain("[lsp-daemon] startup deferred: startup_lock_busy");
		expect(result.stderr).not.toContain("at ");
	});

	it("keeps the stack for an unexpected startup error", async () => {
		const dir = mkdtempSync(join(tmpdir(), "lsp-cli-invalid-"));
		directories.push(dir);
		const result = await runCli({
			OMO_LSP_DAEMON_DIR: dir,
			OMO_LSP_DAEMON_CLI: join(dir, "missing-cli.js"),
			OMO_LSP_DAEMON_VERSION: "cli-test",
		});
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("InvalidRuntimeOverrideError");
		expect(result.stderr).toContain("at ");
	});
});
