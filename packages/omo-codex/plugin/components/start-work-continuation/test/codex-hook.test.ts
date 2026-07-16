import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runStopHook } from "../src/codex-hook.js";
import type { ReadonlyFileSystem, StopInput } from "../src/types.js";

const DEFAULT_WORKSPACE = "/repo";
const cleanupRoots: string[] = [];
const SCAFFOLD_PLAN_MARKDOWN = readFileSync(new URL("./fixtures/plan-scaffold.md", import.meta.url), "utf8");

afterEach(() => {
	for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("start-work Stop hook", () => {
	it("#given stop hook is already active #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs();
		const input = { ...createStopInput(), stop_hook_active: true };

		// when
		const output = runStopHook(input, fs);

		// then
		expect(output).toBe("");
	});

	it("#given no boulder state and start work prompt #when stop hook runs #then it stays quiet", () => {
		// given
		const fs = createMemoryFs();
		const input = {
			...createStopInput(),
			last_assistant_message: "I'll start work on this plan now.",
		};

		// when
		const output = runStopHook(input, fs);

		// then
		expect(output).toBe("");
	});

	it("#given active codex work with remaining top-level tasks #when hook runs #then returns block JSON", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
				worktreePath: "/tmp/worktree",
			}),
			planMarkdown: SCAFFOLD_PLAN_MARKDOWN,
		});
		const fs = createMemoryFs();

		// when
		const output = runStopHook(createStopInput(workspace), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toContain("- Plan: `launch-plan`");
		expect(parsed.reason).toContain(`- Plan file: \`${join(workspace, ".omo", "plans", "plan.md")}\``);
		expect(parsed.reason).toContain(`- Boulder state: \`${join(workspace, ".omo", "boulder.json")}\``);
		expect(parsed.reason).toContain("- Remaining top-level checkboxes: `2` of `4`");
		expect(parsed.reason).toContain("- Next incomplete task: `1. Implement checklist parser parity`");
		expect(parsed.reason).toContain("- Worktree: `/tmp/worktree`");
		expect(parsed.reason).toContain(`- Ledger: \`${join(workspace, ".omo", "start-work", "ledger.jsonl")}\``);
		expect(parsed.reason).toContain("- Your session id in boulder.json: `codex:sess_abc`");
	});

	it("#given active codex work with zero remaining tasks #when hook runs #then blocks for the final gate", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ sessionIds: ["codex:sess_abc"], status: "active" }),
			planMarkdown: ["# Plan", "", "## TODOs", "- [x] Done"].join("\n"),
		});
		const fs = createMemoryFs();

		// when
		const output = runStopHook(createStopInput(workspace), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toContain("- Remaining top-level checkboxes: `0` of `1`");
		expect(parsed.reason).toContain("- Next incomplete task: `none (final gate pending)`");
		expect(parsed.reason).toContain("When the remaining count is `0`, skip checkbox execution");
		expect(parsed.reason).toContain("re-read the ledger record and verify the exact lane/SHA pair");
	});

	it("#given context-window pressure in transcript #when hook runs #then it does not inject continuation text", () => {
		// given
		const transcriptPath = "/repo/transcript.jsonl";
		const fs = createMemoryFs({
			[transcriptPath]: [
				JSON.stringify({
					type: "message",
					payload: {
						content: {
							error: {
								code: "context_too_large",
							},
						},
					},
				}),
				"Your input exceeds the context window of this model.",
				"",
			].join("\n"),
		});

		// when
		const output = runStopHook({ ...createStopInput(), transcript_path: transcriptPath }, fs);

		// then
		expect(output).toBe("");
	});

	it("#given active work belongs to another harness #when hook runs #then returns empty output", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ sessionIds: ["opencode:sess_abc"], status: "active" }),
			planMarkdown: "- [ ] First",
		});
		const fs = createMemoryFs();

		// when
		const output = runStopHook(createStopInput(workspace), fs);

		// then
		expect(output).toBe("");
	});

	it("#given bare legacy session id #when hook runs #then returns empty output", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ sessionIds: ["sess_abc"], status: "active" }),
			planMarkdown: "- [ ] First",
		});
		const fs = createMemoryFs();

		// when
		const output = runStopHook(createStopInput(workspace), fs);

		// then
		expect(output).toBe("");
	});

	it("#given completed boulder work #when hook runs #then returns empty output", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ sessionIds: ["codex:sess_abc"], status: "completed" }),
			planMarkdown: "- [ ] First",
		});
		const fs = createMemoryFs();

		// when
		const output = runStopHook(createStopInput(workspace), fs);

		// then
		expect(output).toBe("");
	});

	it("#given malformed boulder JSON #when hook runs #then returns empty output", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: "{",
			planMarkdown: "- [ ] First",
		});
		const fs = createMemoryFs();

		// when
		const output = runStopHook(createStopInput(workspace), fs);

		// then
		expect(output).toBe("");
	});

	it("#given malformed input #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs();

		// when
		const output = runStopHook({ hook_event_name: "Stop", session_id: 123 }, fs);

		// then
		expect(output).toBe("");
	});
});

type BoulderInput = {
	readonly sessionIds: readonly string[];
	readonly status: "active" | "completed" | "paused" | "abandoned";
	readonly worktreePath?: string;
};

type WorkspaceInput = {
	readonly boulderJson: string;
	readonly planMarkdown: string;
};

function createStopInput(cwd = DEFAULT_WORKSPACE): StopInput {
	return {
		hook_event_name: "Stop",
		session_id: "sess_abc",
		turn_id: "turn_1",
		transcript_path: "",
		cwd,
		model: "gpt-5.5",
		permission_mode: "default",
		stop_hook_active: false,
		last_assistant_message: "done",
	};
}

function createWorkspace(input: WorkspaceInput): string {
	const root = mkdtempSync(join(tmpdir(), "codex-continuation-hook-"));
	cleanupRoots.push(root);
	mkdirSync(join(root, ".omo", "plans"), { recursive: true });
	writeFileSync(join(root, ".omo", "plans", "plan.md"), input.planMarkdown);
	writeFileSync(join(root, ".omo", "boulder.json"), input.boulderJson);
	return root;
}

function createBoulderJson(input: BoulderInput): string {
	const work = {
		work_id: "work_1",
		active_plan: ".omo/plans/plan.md",
		plan_name: "launch-plan",
		status: input.status,
		started_at: "2026-06-13T00:00:00.000Z",
		session_ids: input.sessionIds,
		...(input.worktreePath === undefined ? {} : { worktree_path: input.worktreePath }),
	};
	return JSON.stringify({
		schema_version: 2,
		active_work_id: "work_1",
		works: { work_1: work },
		active_plan: ".omo/plans/plan.md",
		plan_name: "legacy-launch-plan",
		started_at: "2026-06-13T00:00:00.000Z",
		status: input.status,
		session_ids: input.sessionIds,
	});
}

function createMemoryFs(files: Record<string, string> = {}): ReadonlyFileSystem {
	return {
		readFileSync(path, encoding) {
			expect(encoding).toBe("utf8");
			const value = files[path];
			if (value === undefined) throw new Error(`Missing fixture: ${path}`);
			return value;
		},
	};
}

function parseBlockOutput(output: string): { readonly decision: "block"; readonly reason: string } {
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
