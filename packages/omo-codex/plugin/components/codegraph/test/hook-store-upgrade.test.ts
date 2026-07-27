import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { executeCodegraphSessionStartHook, type WorkerSpawnInvocation } from "../src/hook.ts";

const pluginRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function createAllowedWorkspace(prefix: string): string {
	return mkdtempSync(join(pluginRoot, `.tmp-${prefix}-`));
}

describe("CodeGraph SessionStart hook with a migrated 1.0.1 project store under CodeGraph 1.5.0", () => {
	it("#given the migrated store has an exact database #when SessionStart runs #then it never invokes the CodeGraph CLI", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-upgrade-home-"));
		const workspace = createAllowedWorkspace("codegraph-upgrade-workspace");
		try {
			mkdirSync(join(workspace, ".codegraph"), { recursive: true });
			writeFileSync(join(workspace, ".codegraph", "codegraph.db"), "migrated-store");

			// when
			const result = await executeCodegraphSessionStartHook({
				ancestorProbe: () => {
					throw new Error("the exact database check must be the complete fast path");
				},
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: homeDir },
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
				sweepZombies: () => undefined,
			});

			// then
			expect(result).toEqual({ action: "skipped-initialized", exitCode: 0 });
			expect(spawned).toEqual([]);
			expect(stdout.join("")).toBe("");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
