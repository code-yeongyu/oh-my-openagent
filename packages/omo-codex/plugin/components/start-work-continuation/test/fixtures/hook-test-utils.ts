import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

import type { ReadonlyFileSystem, StopInput } from "../../src/types.js";

export const DEFAULT_WORKSPACE = "/repo";

const cleanupRoots: string[] = [];

export type BoulderInput = {
	readonly sessionIds?: readonly string[];
	readonly status?: "active" | "completed" | "paused" | "abandoned";
	readonly worktreePath?: string | null;
};

export type WorkspaceInput = {
	readonly boulderJson?: string;
	readonly planMarkdown?: string;
	readonly worktreePath?: string | null;
};

export function cleanupTestRoots(): void {
	for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function createStopInput(cwd = DEFAULT_WORKSPACE, sessionId = "sess_abc"): StopInput {
	return {
		hook_event_name: "Stop",
		session_id: sessionId,
		turn_id: "turn_1",
		transcript_path: "",
		cwd,
		model: "gpt-5.5",
		permission_mode: "default",
		stop_hook_active: false,
		last_assistant_message: "done",
	};
}

export function createWorkspace(input: WorkspaceInput = {}): string {
	const root = createTempRoot("codex-continuation-hook-");
	createPlan(root, input.planMarkdown);
	writeFileSync(join(root, ".omo", "boulder.json"), input.boulderJson ?? createBoulderJson(input));
	return root;
}

export function createTempRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	cleanupRoots.push(root);
	return root;
}

export function createPlan(root: string, planMarkdown = ["# Plan", "", "## TODOs", "- [ ] First"].join("\n")): void {
	mkdirSync(join(root, ".omo", "plans"), { recursive: true });
	writeFileSync(join(root, ".omo", "plans", "plan.md"), planMarkdown);
}

export function createBoulderJson(input: BoulderInput = {}): string {
	const work = {
		work_id: "work_1",
		active_plan: ".omo/plans/plan.md",
		plan_name: "launch-plan",
		status: input.status ?? "active",
		started_at: "2026-06-13T00:00:00.000Z",
		session_ids: input.sessionIds ?? ["codex:sess_abc"],
		...(input.worktreePath === undefined || input.worktreePath === null ? {} : { worktree_path: input.worktreePath }),
	};
	return JSON.stringify({
		schema_version: 2,
		active_work_id: "work_1",
		works: { work_1: work },
		active_plan: ".omo/plans/plan.md",
		plan_name: "legacy-launch-plan",
		started_at: "2026-06-13T00:00:00.000Z",
		status: input.status ?? "active",
		session_ids: input.sessionIds ?? ["codex:sess_abc"],
	});
}

export function createMemoryFs(files: Record<string, string> = {}): ReadonlyFileSystem {
	return {
		lstatSync(path) {
			const value = files[path];
			if (value === undefined) throw new Error(`Missing fixture: ${path}`);
			return { size: Buffer.byteLength(value, "utf8"), isFile: () => true };
		},
		readFileSync(path, encoding) {
			expect(encoding).toBe("utf8");
			const value = files[path];
			if (value === undefined) throw new Error(`Missing fixture: ${path}`);
			return value;
		},
	};
}

export function createDiskBackedFs(files: Record<string, string | Error> = {}): ReadonlyFileSystem {
	return {
		lstatSync(path) {
			const value = files[path];
			if (value instanceof Error) throw value;
			if (value !== undefined) return { size: Buffer.byteLength(value, "utf8"), isFile: () => true };
			return lstatSync(path);
		},
		readFileSync(path, encoding) {
			expect(encoding).toBe("utf8");
			const value = files[path];
			if (value instanceof Error) throw value;
			if (value !== undefined) return value;
			return readFileSync(path, encoding);
		},
	};
}

export function writeSnapshot(root: string, markdown: string): string {
	return writeSnapshotAt(root, ["sess_abc"], markdown);
}

export function writeSnapshotAt(root: string, segments: readonly string[], markdown: string): string {
	const snapshotPath = join(root, ".omo", "ulw-loop", ...segments, "snapshots", "latest.md");
	mkdirSync(join(snapshotPath, ".."), { recursive: true });
	writeFileSync(snapshotPath, markdown);
	return snapshotPath;
}

export function parseBlockOutput(output: string): { readonly decision: "block"; readonly reason: string } {
	const parsed: unknown = JSON.parse(output);
	if (!isRecord(parsed)) throw new Error("Expected object output");
	if (parsed["decision"] !== "block") throw new Error("Expected block decision");
	const reason = parsed["reason"];
	if (typeof reason !== "string") throw new Error("Expected string reason");
	return { decision: "block", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
