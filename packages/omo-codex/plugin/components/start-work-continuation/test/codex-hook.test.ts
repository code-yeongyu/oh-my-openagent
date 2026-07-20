import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runStopHook } from "../src/codex-hook.js";
import {
	cleanupTestRoots,
	createBoulderJson,
	createMemoryFs,
	createStopInput,
	createWorkspace,
	parseBlockOutput,
} from "./fixtures/hook-test-utils.js";

afterEach(() => {
	cleanupTestRoots();
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
			planMarkdown: ["# Plan", "", "## TODOs", "- [x] 1. Done"].join("\n"),
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

	it("#given active codex work #when continuation directive is emitted #then subagent guidance is reliable", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ sessionIds: ["codex:sess_abc"], status: "active" }),
			planMarkdown: ["# Plan", "", "## TODOs", "- [ ] First"].join("\n"),
		});
		const fs = createMemoryFs();

		// when
		const output = runStopHook(createStopInput(workspace), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/TASK:/);
		expect(parsed.reason).toMatch(/fork_context:\s*false/);
		expect(parsed.reason).toMatch(/wait_agent.*mailbox signals/);
		expect(parsed.reason).toMatch(/TASK STILL ACTIVE/);
		expect(parsed.reason).toMatch(/respawn.*smaller/);
		expect(parsed.reason).toMatch(/WORKING:/);
	});

	it("#given active codex work #when continuation directive is emitted #then QA weight is tier-scoped without echo bloat", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ sessionIds: ["codex:sess_abc"], status: "active" }),
			planMarkdown: ["# Plan", "", "## TODOs", "- [ ] First"].join("\n"),
		});
		const fs = createMemoryFs();

		// when
		const output = runStopHook(createStopInput(workspace), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/LIGHT/);
		expect(parsed.reason).toMatch(/HEAVY/);
		expect(parsed.reason).toMatch(/When unsure[^.]{0,30}HEAVY/);
		expect(parsed.reason).toMatch(/mirrors its implementation/);
		expect((parsed.reason.match(/malformed input, prompt injection/g) ?? []).length).toBe(1);
		expect(parsed.reason.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(1150);
	});

	it("#given active codex work #when continuation directive is emitted #then PR lifecycle stays worktree-bound", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
				worktreePath: "/tmp/worktree",
			}),
			planMarkdown: ["# Plan", "", "## TODOs", "- [ ] First"].join("\n"),
		});
		const fs = createMemoryFs();

		// when
		const output = runStopHook(createStopInput(workspace), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toContain(
			"PR or branch implementation/review/merge work requires a task-owned git worktree",
		);
		expect(parsed.reason).toContain("Treat the main worktree as read-only context");
		expect(parsed.reason).toContain("create/update the PR, wait for CI/review/Cubic gates, merge by default");
		expect(parsed.reason).toContain("Do not create a PR, PR handoff, branch handoff, merge");
	});

	it("#given stop hook source #when inspected #then it remains Boulder-only without planning bootstrap logic", () => {
		// given
		const hook = readFileSync(new URL("../src/codex-hook.ts", import.meta.url), "utf8");

		// then
		expect(hook).toMatch(/readContinuationState/);
		expect(hook).toMatch(/START_WORK_CONTINUATION_DIRECTIVE/);
		expect(hook).toMatch(/decision:\s*"block"/);
		expect(hook).not.toMatch(
			/\bulw-plan\b|\bspawn_agent\b|\brequest_user_input\b|bootstrap|selectable plan|Phase 1|Create or update Boulder state/i,
		);
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
