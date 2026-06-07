import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runStopHook } from "../src/codex-hook.js";
import type { ReadonlyFileSystem, StopInput } from "../src/types.js";

const WORKSPACE = "/repo";
const BOULDER_PATH = join(WORKSPACE, ".omo", "boulder.json");
const PLAN_PATH = join(WORKSPACE, ".omo", "plans", "plan.md");
const LEDGER_PATH = join(WORKSPACE, ".omo", "start-work", "ledger.jsonl");
const STARTED_AT = "2026-06-05T01:00:00.000Z";

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

	it("#given legacy root-mirror codex work with remaining tasks #when hook runs #then returns block JSON", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createLegacyBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [ ] Legacy task"].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toContain("- Work id: `launch-plan-legacy`");
		expect(parsed.reason).toContain("- Next incomplete task: `Legacy task`");
	});

	it("#given legacy root-mirror codex work with all tasks done and unscoped gate evidence #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createLegacyBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] Legacy task"].join("\n"),
			[LEDGER_PATH]: JSON.stringify({ event: "global-review-debug-gate-passed", verdict: "PASS" }),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given legacy root-mirror codex work with stale started_at gate evidence #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createLegacyBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] Legacy task"].join("\n"),
			[LEDGER_PATH]: JSON.stringify(createGatePassLedgerEntry({ startedAt: "2026-06-04T01:00:00.000Z" })),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
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

	it("#given active codex work #when continuation directive is emitted #then completion requires global review and debugging", () => {
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
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/\breview-work\b/);
		expect(parsed.reason).toMatch(/\bdebugging\b/);
		expect(parsed.reason).toMatch(/three plausible failure hypotheses/);
		expect(parsed.reason).toMatch(/redact|mask/i);
		expect(parsed.reason).toMatch(/raw tokens/i);
		expect(parsed.reason).toMatch(/PR creation/);
		expect(parsed.reason).toMatch(/PR handoff/);
		expect(parsed.reason).not.toMatch(/codex-ultrawork-reviewer` approved unconditionally/);
	});

	it("#given active codex work with all checkboxes done #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First", "- [x] Second"].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toMatch(/Remaining top-level checkboxes: `0` of `2`/);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/All top-level checkboxes are complete/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
		expect(parsed.reason).toMatch(/ORCHESTRATION COMPLETE/);
	});

	it("#given active codex work with no counted checkboxes #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "No counted checkbox tasks."].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toMatch(/Remaining top-level checkboxes: `0` of `0`/);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given active codex work with all checkboxes done and final gate evidence #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: JSON.stringify(createGatePassLedgerEntry()),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		expect(output).toBe("");
	});

	it("#given active codex work with all checkboxes done and gate marker missing evidence #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: JSON.stringify({
				event: "global-review-debug-gate-passed",
				verdict: "PASS",
				work_id: "work_1",
				plan: "launch-plan",
				plan_path: PLAN_PATH,
				session_id: "codex:sess_abc",
				started_at: STARTED_AT,
			}),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given final gate evidence without all review lanes #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: JSON.stringify(
				createGatePassLedgerEntry({ reviewLanes: ["goal", "quality", "security", "context"] }),
			),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given final gate evidence with negative string claims #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: JSON.stringify(
				createGatePassLedgerEntry({
					verification: "tests failed",
					review: "PASS. all lanes failed",
					debugging: ["stale marker", "wrong work", "external plan"],
					artifact: "redaction omitted",
					cleanup: "not done",
				}),
			),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given final gate evidence with negative structured claims #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: JSON.stringify(
				createGatePassLedgerEntry({
					verification: { verdict: "PASS", commands: ["tests failed"] },
					debugging: { verdict: "PASS", hypotheses: ["stale marker", "blocked review", "external plan"] },
					artifact: { redacted: true, summary: "redaction omitted" },
					cleanup: { status: "complete", summary: "not done" },
				}),
			),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given final gate evidence with malformed structured claims #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: JSON.stringify(
				createGatePassLedgerEntry({
					verification: { verdict: "PASS", commands: [null] },
				}),
			),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given final gate evidence with a raw sensitive extra field #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: JSON.stringify({
				...createGatePassLedgerEntry(),
				raw_log: `${"Authorization: Bearer "}${"token-like-value"}`,
			}),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given boulder work without started_at and an old final gate marker #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				startedAt: null,
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: JSON.stringify(createGatePassLedgerEntry({ startedAt: "2026-06-04T01:00:00.000Z" })),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given final gate evidence followed by a scoped task-completed entry #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: [createGatePassLedgerEntry(), createTaskCompletedLedgerEntry()]
				.map((entry) => JSON.stringify(entry))
				.join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given active codex work with unscoped final gate evidence #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: JSON.stringify({ event: "global-review-debug-gate-passed", verdict: "PASS" }),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given active codex work with symlinked plan outside workspace #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs(
			{
				[BOULDER_PATH]: createBoulderJson({
					sessionIds: ["codex:sess_abc"],
					status: "active",
				}),
			},
			{
				[WORKSPACE]: WORKSPACE,
				[PLAN_PATH]: "/tmp/outside-plan.md",
			},
		);

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		expect(output).toBe("");
	});

	it("#given active codex work with stale final gate evidence #when hook runs #then final gate still blocks completion", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [x] First"].join("\n"),
			[LEDGER_PATH]: JSON.stringify(createGatePassLedgerEntry({ workId: "old_work" })),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/Global Review and Debugging Gate/);
		expect(parsed.reason).toMatch(/global-review-debug-gate-passed/);
	});

	it("#given multiple works share the current session #when active work id points to another work #then hook uses active work id first", () => {
		// given
		const oldPlanPath = join(WORKSPACE, ".omo", "plans", "old.md");
		const activePlanPath = join(WORKSPACE, ".omo", "plans", "active.md");
		const oldWork = createBoulderWork({
			activePlan: ".omo/plans/old.md",
			planName: "old-plan",
			sessionIds: ["codex:sess_abc"],
			status: "active",
			workId: "old_work",
		});
		const activeWork = createBoulderWork({
			activePlan: ".omo/plans/active.md",
			planName: "active-plan",
			sessionIds: ["codex:sess_abc"],
			status: "active",
			workId: "active_work",
		});
		const fs = createMemoryFs({
			[BOULDER_PATH]: JSON.stringify({
				schema_version: 2,
				active_work_id: "active_work",
				works: { old_work: oldWork, active_work: activeWork },
			}),
			[oldPlanPath]: ["# Old", "", "## TODOs", "- [x] Old task"].join("\n"),
			[activePlanPath]: ["# Active", "", "## TODOs", "- [ ] Active task"].join("\n"),
			[LEDGER_PATH]: JSON.stringify(
				createGatePassLedgerEntry({
					planName: "old-plan",
					planPath: oldPlanPath,
					workId: "old_work",
				}),
			),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toContain("- Work id: `active_work`");
		expect(parsed.reason).toContain("- Plan: `active-plan`");
		expect(parsed.reason).toContain("- Next incomplete task: `Active task`");
	});

	it("#given active codex work with external plan path #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[BOULDER_PATH]: createBoulderJson({
				activePlan: "../outside.md",
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			"/outside.md": ["# Outside", "", "## TODOs", "- [ ] Secret label"].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		expect(output).toBe("");
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
	readonly activePlan?: string;
	readonly sessionIds: readonly string[];
	readonly startedAt?: string | null;
	readonly status: "active" | "completed" | "paused" | "abandoned";
	readonly workId?: string;
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
	const work = createBoulderWork({ ...input, planName: "launch-plan" });
	return JSON.stringify({ schema_version: 2, active_work_id: "work_1", works: { work_1: work } });
}

type BoulderWorkInput = BoulderInput & {
	readonly planName: string;
};

function createBoulderWork(input: BoulderWorkInput): Record<string, unknown> {
	return {
		work_id: input.workId ?? "work_1",
		active_plan: input.activePlan ?? ".omo/plans/plan.md",
		plan_name: input.planName,
		status: input.status,
		...(input.startedAt === null ? {} : { started_at: input.startedAt ?? STARTED_AT }),
		session_ids: input.sessionIds,
		...(input.worktreePath === undefined ? {} : { worktree_path: input.worktreePath }),
	};
}

function createLegacyBoulderJson(input: BoulderInput): string {
	return JSON.stringify({
		schema_version: 2,
		active_plan: input.activePlan ?? ".omo/plans/plan.md",
		plan_name: "launch-plan",
		status: input.status,
		...(input.startedAt === null ? {} : { started_at: input.startedAt ?? STARTED_AT }),
		session_ids: input.sessionIds,
		...(input.worktreePath === undefined ? {} : { worktree_path: input.worktreePath }),
	});
}

function createGatePassLedgerEntry(
	input: {
		readonly planName?: string;
		readonly planPath?: string;
		readonly artifact?: unknown;
		readonly cleanup?: unknown;
		readonly debugging?: unknown;
		readonly reviewLanes?: readonly string[];
		readonly review?: unknown;
		readonly startedAt?: string;
		readonly verification?: unknown;
		readonly workId?: string;
	} = {},
): Record<string, unknown> {
	return {
		event: "global-review-debug-gate-passed",
		verdict: "PASS",
		work_id: input.workId ?? "work_1",
		plan: input.planName ?? "launch-plan",
		plan_path: input.planPath ?? PLAN_PATH,
		session_id: "codex:sess_abc",
		started_at: input.startedAt ?? STARTED_AT,
		verification: input.verification ?? { verdict: "PASS", commands: ["npm test"] },
		review: input.review ?? {
			verdict: "PASS",
			lanes: input.reviewLanes ?? ["goal", "quality", "security", "qa", "context"],
		},
		debugging: input.debugging ?? { verdict: "PASS", hypotheses: ["stale marker", "wrong work", "external plan"] },
		artifact: input.artifact ?? { redacted: true, summary: "redacted artifact evidence" },
		cleanup: input.cleanup ?? { status: "complete", summary: "temp resources removed" },
	};
}

function createTaskCompletedLedgerEntry(): Record<string, string> {
	return {
		event: "task-completed",
		work_id: "work_1",
		plan: "launch-plan",
		plan_path: PLAN_PATH,
		session_id: "codex:sess_abc",
	};
}

function createMemoryFs(
	files: Record<string, string> = {},
	realpaths: Record<string, string> = {},
): ReadonlyFileSystem {
	return {
		readFileSync(path, encoding) {
			expect(encoding).toBe("utf8");
			const value = files[path];
			if (value === undefined) throw new Error(`Missing fixture: ${path}`);
			return value;
		},
		realpathSync(path) {
			return realpaths[path] ?? path;
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
