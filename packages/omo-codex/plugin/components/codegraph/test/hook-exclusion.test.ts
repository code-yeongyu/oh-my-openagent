import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
	executeCodegraphSessionStartHook,
	type WorkerSpawnInvocation,
} from "../src/hook.ts";

const pluginRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function createAllowedWorkspace(prefix: string): string {
	return mkdtempSync(join(pluginRoot, `.tmp-${prefix}-`));
}

describe("CodeGraph SessionStart exclusion policy", () => {
	it("#given project root is inside an OMO state directory #when SessionStart fires #then it skips before probing or spawning", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		const stateRoot = createAllowedWorkspace("codegraph-omo-state");
		const workspace = join(stateRoot, ".omo", "ulw-research", "run", "clones", "repo");
		mkdirSync(workspace, { recursive: true });

		try {
			// when
			const result = await executeCodegraphSessionStartHook({
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: "/tmp/home" },
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
				statusProbe: () => {
					throw new Error("excluded projects must not probe CodeGraph status");
				},
			});

			// then
			expect(result).toEqual({ action: "skipped-excluded", exitCode: 0 });
			expect(spawned).toEqual([]);
			expect(stdout.join("")).toBe("");
		} finally {
			rmSync(stateRoot, { recursive: true, force: true });
		}
	});

	it("#given project root is under a configured excluded root #when SessionStart fires #then it skips before spawning", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		const excludedRoot = createAllowedWorkspace("codegraph-custom-excluded");
		const workspace = join(excludedRoot, "repo");
		mkdirSync(workspace, { recursive: true });

		try {
			// when
			const result = await executeCodegraphSessionStartHook({
				config: { codegraph: { enabled: true, excluded_roots: [excludedRoot] }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: "/tmp/home" },
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
				statusProbe: () => Promise.resolve(false),
			});

			// then
			expect(result).toEqual({ action: "skipped-excluded", exitCode: 0 });
			expect(spawned).toEqual([]);
			expect(stdout.join("")).toBe("");
		} finally {
			rmSync(excludedRoot, { recursive: true, force: true });
		}
	});

	it("#given project root is under /tmp #when SessionStart fires on POSIX #then it skips before spawning", async () => {
		if (process.platform === "win32") return;

		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		const workspace = mkdtempSync(join("/tmp", "omo-codegraph-excluded-"));

		try {
			// when
			const result = await executeCodegraphSessionStartHook({
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: "/tmp/home" },
				stdin: Readable.from(["{}"]),
				stdout: { write: (chunk) => stdout.push(chunk) },
				spawnWorker: (invocation) => spawned.push(invocation),
				statusProbe: () => Promise.resolve(false),
			});

			// then
			expect(result).toEqual({ action: "skipped-excluded", exitCode: 0 });
			expect(spawned).toEqual([]);
			expect(stdout.join("")).toBe("");
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
