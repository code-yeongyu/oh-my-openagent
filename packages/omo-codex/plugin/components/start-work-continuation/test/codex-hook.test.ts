import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runStopHook } from "../src/codex-hook.js";
import type { ReadonlyFileSystem, StopInput } from "../src/types.js";

const WORKSPACE = "/repo";
const BOULDER_PATH = join(WORKSPACE, ".omo", "boulder.json");
const PLAN_PATH = join(WORKSPACE, ".omo", "plans", "plan.md");
const LEDGER_PATH = join(WORKSPACE, ".omo", "start-work", "ledger.jsonl");

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
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
				worktreePath: "/tmp/worktree",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [ ] First", "- [x] Done", "- [ ] Second"].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toContain("- Plan: `launch-plan`");
		expect(parsed.reason).toContain(`- Plan file: \`${PLAN_PATH}\``);
		expect(parsed.reason).toContain(`- Boulder state: \`${BOULDER_PATH}\``);
		expect(parsed.reason).toContain("- Remaining top-level checkboxes: `2` of `3`");
		expect(parsed.reason).toContain("- Next incomplete task: `First`");
		expect(parsed.reason).toContain("- Worktree: `/tmp/worktree`");
		expect(parsed.reason).toContain(`- Ledger: \`${LEDGER_PATH}\``);
		expect(parsed.reason).toContain("- Your session id in boulder.json: `codex:sess_abc`");
	});

	it("#given context-window pressure in transcript #when hook runs #then it does not inject continuation text", () => {
		// given
		const transcriptPath = "/repo/transcript.jsonl";
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [ ] First"].join("\n"),
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

	it("#given active codex work #when continuation directive is emitted #then subagent guidance is reliable", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [ ] First"].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/TASK:/);
		expect(parsed.reason).toMatch(/fork_turns:\s*"none"/);
		expect(parsed.reason).toMatch(/wait_agent.*mailbox signals/);
		expect(parsed.reason).toMatch(/TASK STILL ACTIVE/);
		expect(parsed.reason).toMatch(/respawn.*smaller/);
		expect(parsed.reason).toMatch(/WORKING:/);
		expect(parsed.reason).toMatch(/single `list_agents`/);
	});

	it("#given active work belongs to another harness #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({ sessionIds: ["opencode:sess_abc"], status: "active" }),
			[PLAN_PATH]: "- [ ] First",
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		expect(output).toBe("");
	});

	it("#given bare legacy session id #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({ sessionIds: ["sess_abc"], status: "active" }),
			[PLAN_PATH]: "- [ ] First",
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		expect(output).toBe("");
	});

	it("#given completed boulder work #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({ sessionIds: ["codex:sess_abc"], status: "completed" }),
			[PLAN_PATH]: "- [ ] First",
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		expect(output).toBe("");
	});

	it("#given malformed boulder JSON #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: "{",
		});

		// when
		const output = runStopHook(createStopInput(), fs);

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

function createStopInput(): StopInput {
	return {
		hook_event_name: "Stop",
		session_id: "sess_abc",
		turn_id: "turn_1",
		transcript_path: "",
		cwd: WORKSPACE,
		model: "gpt-5.5",
		permission_mode: "default",
		stop_hook_active: false,
		last_assistant_message: "done",
	};
}

function createBoulderJson(input: BoulderInput): string {
	const work = {
		work_id: "work_1",
		active_plan: ".omo/plans/plan.md",
		plan_name: "launch-plan",
		status: input.status,
		session_ids: input.sessionIds,
		...(input.worktreePath === undefined ? {} : { worktree_path: input.worktreePath }),
	};
	return JSON.stringify({ schema_version: 2, active_work_id: "work_1", works: { work_1: work } });
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
