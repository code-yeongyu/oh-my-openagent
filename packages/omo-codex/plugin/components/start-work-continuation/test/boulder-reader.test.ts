import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPlanChecklist, readContinuationState } from "../src/boulder-reader.js";

const cleanupRoots: string[] = [];

afterEach(() => {
	for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("start-work plan checklist consumption", () => {
	it("#given top-level completed and incomplete checkboxes #when parsed #then counts remaining and total", () => {
		// given
		const planPath = createPlan(
			["# Plan", "", "## TODOs", "- [ ] First", "- [x] Done", "- [X] Also done", "- [ ] Second"].join("\n"),
		);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({ completed: 2, remaining: 2, total: 4, nextTaskLabel: "First" });
	});

	it("#given nested checkboxes #when parsed #then ignores non-column-zero items", () => {
		// given
		const planPath = createPlan(
			["## TODOs", "- [ ] Top-level", "  - [ ] Nested", "\t- [ ] Tab nested", "- [x] Complete"].join("\n"),
		);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({ completed: 1, remaining: 1, total: 2, nextTaskLabel: "Top-level" });
	});

	it("#given checkboxes outside counted sections #when parsed #then ignores unrelated top-level tasks", () => {
		// given
		const planPath = createPlan(
			[
				"# Plan",
				"- [ ] Preamble task",
				"## TODOs",
				"- [ ] Build hook",
				"## Acceptance Criteria",
				"- [ ] Acceptance item",
				"## Final Verification Wave",
				"- [x] Run tests",
				"- [ ] Run smoke",
			].join("\n"),
		);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({ completed: 1, remaining: 2, total: 3, nextTaskLabel: "Build hook" });
	});

	it("#given all top-level tasks complete #when parsed #then next task is null", () => {
		// given
		const planPath = createPlan(["## TODOs", "- [x] First", "- [X] Second"].join("\n"));

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({ completed: 2, remaining: 0, total: 2, nextTaskLabel: null });
	});
});

describe("start-work boulder state reader", () => {
	it("#given active codex work with remaining checklist #when state is read #then continuation fields match baseline", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ status: "active", sessionIds: ["codex:sess_abc"] }),
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] First\n- [x] Done\n- [ ] Second\n",
		});

		// when
		const state = readContinuationState(workspace, "sess_abc");

		// then
		expect(state).toEqual({
			planName: "launch-plan",
			planPath: join(workspace, ".omo", "plans", "plan.md"),
			boulderPath: join(workspace, ".omo", "boulder.json"),
			ledgerPath: join(workspace, ".omo", "start-work", "ledger.jsonl"),
			worktreePath: null,
			checklist: { completed: 1, remaining: 2, total: 3, nextTaskLabel: "First" },
		});
	});

	it("#given completed codex work #when state is read #then continuation is absent", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ status: "completed", sessionIds: ["codex:sess_abc"] }),
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] First\n",
		});

		// when
		const state = readContinuationState(workspace, "sess_abc");

		// then
		expect(state).toBeNull();
	});

	it("#given paused codex work with remaining checklist #when state is read #then continuation is present", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ status: "paused", sessionIds: ["codex:sess_abc"] }),
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] First\n",
		});

		// when
		const state = readContinuationState(workspace, "sess_abc");

		// then
		expect(state?.planName).toBe("launch-plan");
		expect(state?.checklist).toEqual({ completed: 0, remaining: 1, total: 1, nextTaskLabel: "First" });
	});

	it("#given active codex work with no remaining checklist items #when state is read #then final gate continuation remains present", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ status: "active", sessionIds: ["codex:sess_abc"] }),
			planMarkdown: "# Plan\n\n## TODOs\n- [x] First\n",
		});

		// when
		const state = readContinuationState(workspace, "sess_abc");

		// then
		expect(state?.checklist).toEqual({ completed: 1, remaining: 0, total: 1, nextTaskLabel: null });
	});

	it("#given active codex work with no readable checklist #when state is read #then continuation remains absent", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ status: "active", sessionIds: ["codex:sess_abc"] }),
			planMarkdown: "# Plan\n\nNo checklist yet.\n",
		});

		// when
		const state = readContinuationState(workspace, "sess_abc");

		// then
		expect(state).toBeNull();
	});

	it("#given corrupt boulder JSON #when state is read #then continuation is absent", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: "{",
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] First\n",
		});

		// when
		const state = readContinuationState(workspace, "sess_abc");

		// then
		expect(state).toBeNull();
	});

	it("#given bare boulder session id #when codex state is read #then continuation is absent", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ status: "active", sessionIds: ["sess_abc"] }),
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] First\n",
		});

		// when
		const state = readContinuationState(workspace, "sess_abc");

		// then
		expect(state).toBeNull();
	});

	it("#given works omit the codex session but stale mirror matches #when state is read #then continuation is absent", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: JSON.stringify({
				schema_version: 2,
				active_work_id: "work_1",
				works: {
					work_1: {
						work_id: "work_1",
						active_plan: ".omo/plans/plan.md",
						plan_name: "current-work",
						status: "active",
						started_at: "2026-06-13T00:00:00.000Z",
						session_ids: ["opencode:sess_other"],
					},
				},
				active_plan: ".omo/plans/plan.md",
				plan_name: "stale-mirror",
				status: "active",
				started_at: "2026-06-12T00:00:00.000Z",
				session_ids: ["codex:sess_abc"],
			}),
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] First\n",
		});

		// when
		const state = readContinuationState(workspace, "sess_abc");

		// then
		expect(state).toBeNull();
	});
});

type WorkspaceInput = {
	readonly boulderJson: string;
	readonly planMarkdown: string;
};

type BoulderInput = {
	readonly status: "active" | "completed" | "paused" | "abandoned";
	readonly sessionIds: readonly string[];
};

function createPlan(markdown: string): string {
	const root = mkdtempSync(join(tmpdir(), "codex-continuation-plan-"));
	cleanupRoots.push(root);
	const planPath = join(root, "plan.md");
	writeFileSync(planPath, markdown);
	return planPath;
}

function createWorkspace(input: WorkspaceInput): string {
	const root = mkdtempSync(join(tmpdir(), "codex-continuation-reader-"));
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
