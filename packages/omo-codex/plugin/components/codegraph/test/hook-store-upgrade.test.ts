import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { executeCodegraphSessionStartHook, type WorkerSpawnInvocation } from "../src/hook.ts";

const pluginRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

// Observed verbatim from a REAL codegraph 1.4.1 binary running `status --json` (exit 0)
// against a project store built by a REAL codegraph 1.0.1 binary
// (see .omo/evidence/codegraph-daemon-process-hygiene/task-2-store-upgrade.txt).
const MIGRATED_1_0_1_STORE_STATUS_JSON = JSON.stringify({
	initialized: true,
	version: "1.4.1",
	projectPath: "/private/tmp/cg-task2/fixture",
	indexPath: "/private/tmp/cg-task2/fixture/.codegraph",
	lastIndexed: "2026-07-21T04:28:09.593Z",
	fileCount: 2,
	nodeCount: 5,
	edgeCount: 4,
	dbSizeBytes: 159744,
	backend: "node-sqlite",
	journalMode: "wal",
	nodesByKind: { file: 2, function: 3 },
	languages: ["typescript"],
	pendingChanges: { added: 0, modified: 0, removed: 0 },
	worktreeMismatch: null,
	index: {
		builtWithVersion: "1.0.1",
		builtWithExtractionVersion: 24,
		currentExtractionVersion: 24,
		reindexRecommended: false,
		state: null,
		pendingRefs: 0,
	},
});

function createAllowedWorkspace(prefix: string): string {
	return mkdtempSync(join(pluginRoot, `.tmp-${prefix}-`));
}

// On win32 execFile cannot run a #!/bin/sh script, so emit a codegraph.cmd batch file instead;
// resolveCodegraphCommandInvocation wraps .cmd in `cmd.exe /d /s /c`, exactly like the real codegraph.cmd.
function createFakeCodegraphBin(scripts: { readonly posix: string; readonly win32: string }): { readonly binPath: string; readonly dir: string } {
	const dir = mkdtempSync(join(tmpdir(), "omo-codegraph-fake-bin-"));
	if (process.platform === "win32") {
		const binPath = join(dir, "codegraph.cmd");
		writeFileSync(binPath, scripts.win32);
		return { binPath, dir };
	}
	const binPath = join(dir, "codegraph");
	writeFileSync(binPath, scripts.posix, { mode: 0o755 });
	chmodSync(binPath, 0o755);
	return { binPath, dir };
}

// Keep the probe hermetic on POSIX but viable on win32: resolveCodegraphCommandInvocation wraps
// the fake .cmd in `cmd.exe /d /s /c`, and Windows can only resolve cmd.exe when the child env
// carries the real system PATH (System32) plus SystemRoot (both whitelisted in SAFE_AMBIENT_ENV_KEYS).
// A POSIX-only PATH makes the probe spawn fail, so the hook reports not-initialized and spawns.
function probeEnv(homeDir: string, binPath: string): Record<string, string> {
	if (process.platform === "win32") {
		const env: Record<string, string> = {
			HOME: homeDir,
			OMO_CODEGRAPH_BIN: binPath,
		};
		if (process.env["PATH"] !== undefined) env["PATH"] = process.env["PATH"];
		if (process.env["SystemRoot"] !== undefined) env["SystemRoot"] = process.env["SystemRoot"];
		return env;
	}
	return { HOME: homeDir, OMO_CODEGRAPH_BIN: binPath, PATH: "/usr/bin:/bin" };
}

describe("CodeGraph SessionStart hook with a 1.0.1-era project store under the 1.4.1 binary", () => {
	it("#given a real 1.4.1 status payload for a migrated 1.0.1 store #when SessionStart probes via the default probe #then it stays silent without spawning a re-init worker", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-upgrade-home-"));
		// The payload is a single JSON line with no cmd metacharacters (% ^ & < > |), so a plain echo is safe.
		const fake = createFakeCodegraphBin({
			posix: `#!/bin/sh\nprintf '%s\\n' '${MIGRATED_1_0_1_STORE_STATUS_JSON}'\n`,
			win32: `@echo off\r\n@echo ${MIGRATED_1_0_1_STORE_STATUS_JSON}\r\n`,
		});
		const workspace = createAllowedWorkspace("codegraph-upgrade-workspace");
		mkdirSync(join(workspace, ".codegraph"), { recursive: true });

		try {
			// when
			const result = await executeCodegraphSessionStartHook({
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: probeEnv(homeDir, fake.binPath),
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
			});

			// then
			expect(result).toEqual({ action: "skipped-initialized", exitCode: 0 });
			expect(spawned).toEqual([]);
			expect(stdout.join("")).toBe("");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(fake.dir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given the status probe hangs past its 2s timeout #when SessionStart fires #then it exits zero promptly and spawns at most one bounded worker", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-slow-home-"));
		const fake = createFakeCodegraphBin({
			posix: "#!/bin/sh\nsleep 30\n",
			win32: '@powershell -NoProfile -Command "Start-Sleep -Seconds 30"\r\n',
		});
		const workspace = createAllowedWorkspace("codegraph-slow-probe-workspace");

		try {
			// when
			const startedAt = Date.now();
			const result = await executeCodegraphSessionStartHook({
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: probeEnv(homeDir, fake.binPath),
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
			});
			const elapsedMs = Date.now() - startedAt;

			// then
			expect(result.exitCode).toBe(0);
			expect(result.action).toBe("spawned");
			expect(spawned).toHaveLength(1);
			expect(elapsedMs).toBeLessThan(15_000);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(fake.dir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
