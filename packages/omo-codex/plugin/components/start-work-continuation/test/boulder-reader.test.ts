import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPlanChecklist, readContinuationState } from "../src/boulder-reader.js";

const cleanupRoots: string[] = [];
const SCAFFOLD_PLAN_MARKDOWN = readFileSync(new URL("./fixtures/plan-scaffold.md", import.meta.url), "utf8");

afterEach(() => {
	for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("start-work plan checklist consumption", () => {
	it("#given scaffold headings and canonical numbered rows #when parsed #then structured totals and next label match", () => {
		// given
		const planPath = createPlan(SCAFFOLD_PLAN_MARKDOWN);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({
			completed: 2,
			remaining: 2,
			total: 4,
			nextTaskLabel: "1. Implement checklist parser parity",
		});
	});

	it("#given nested checkboxes #when parsed #then ignores non-column-zero items", () => {
		// given
		const planPath = createPlan(
			["## TODOs", "- [ ] 1. Top-level", "  - [ ] Nested", "\t- [ ] Tab nested", "- [x] 2. Complete"].join("\n"),
		);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({ completed: 1, remaining: 1, total: 2, nextTaskLabel: "1. Top-level" });
	});

	it("#given checkboxes outside counted sections #when parsed #then ignores unrelated top-level tasks", () => {
		// given
		const planPath = createPlan(
			[
				"# Plan",
				"- [ ] Preamble task",
				"## TODOs",
				"- [ ] 1. Build hook",
				"## Acceptance Criteria",
				"- [ ] Acceptance item",
				"## Final Verification Wave",
				"- [x] F1. Run tests",
				"- [ ] F2. Run smoke",
			].join("\n"),
		);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({ completed: 1, remaining: 2, total: 3, nextTaskLabel: "1. Build hook" });
	});

	it("#given all top-level tasks complete #when parsed #then next task is null", () => {
		// given
		const planPath = createPlan(
			["## Todos", "- [x] 1. First", "- [X] 2. Second", "## Final verification wave", "- [x] F1. Final"].join("\n"),
		);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({ completed: 3, remaining: 0, total: 3, nextTaskLabel: null });
	});

	it("#given no structured headings #when parsed #then legacy top-level checkbox fallback remains", () => {
		// given
		const planPath = createPlan(["# Plan", "- [ ] First", "- [x] Done", "  - [ ] Nested"].join("\n"));

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({ completed: 1, remaining: 1, total: 2, nextTaskLabel: "First" });
	});

	it("#given a heading-free legacy star checklist #when parsed #then fallback behavior is preserved", () => {
		// given
		const planPath = createPlan(["# Plan", "* [ ] First", "* [x] Done", "  * [ ] Nested"].join("\n"));

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({ completed: 1, remaining: 1, total: 2, nextTaskLabel: "First" });
	});

	it("#given noncanonical structured rows #when parsed #then only exact positive-number grammar is counted", () => {
		// given
		const planPath = createPlan(
			[
				"## Todos",
				"- [ ] 0. Zero is invalid",
				"- [ ] 01. Leading zero is invalid",
				"* [ ] 2. Star marker is invalid",
				"-[ ] 3. Missing spaces are invalid",
				"- [ ] 4. Canonical implementation",
				"## Final verification wave",
				"- [ ] F0. Zero final verifier is invalid",
				"- [ ] F01. Leading zero final verifier is invalid",
				"- [x] F2. Canonical final verifier",
			].join("\n"),
		);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({
			completed: 1,
			remaining: 1,
			total: 2,
			nextTaskLabel: "4. Canonical implementation",
		});
	});

	it("#given fenced examples and a higher-level heading #when parsed #then section scope excludes them", () => {
		// given
		const planPath = createPlan(
			[
				"## Todos",
				"- [ ] 1. Counted implementation",
				"```md",
				"- [ ] 2. Fenced example",
				"```",
				"# Appendix",
				"- [ ] 3. Appendix checkbox",
				"## Final verification wave",
				"- [x] F1. Counted verifier",
			].join("\n"),
		);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({
			completed: 1,
			remaining: 1,
			total: 2,
			nextTaskLabel: "1. Counted implementation",
		});
	});

	it("#given a child heading inside TODOs #when parsed #then canonical rows remain in the parent section", () => {
		// given
		const planPath = createPlan(["## TODOs", "- [x] 1. First task", "### Notes", "- [ ] 2. Second task"].join("\n"));

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({ completed: 1, remaining: 1, total: 2, nextTaskLabel: "2. Second task" });
	});

	it("#given a four-backtick fence containing triple-backtick examples #when parsed #then shorter fences do not close it", () => {
		// given
		const planPath = createPlan(
			[
				"## Todos",
				"- [x] 1. Counted implementation",
				"````md",
				"```ts",
				"- [ ] 2. Fenced example",
				"```",
				"````",
				"## Final verification wave",
				"- [ ] F1. Counted verifier",
			].join("\n"),
		);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({
			completed: 1,
			remaining: 1,
			total: 2,
			nextTaskLabel: "F1. Counted verifier",
		});
	});

	it("#given structured headings with ATX closing markers #when parsed #then canonical tasks remain structured", () => {
		// given
		const planPath = createPlan(
			["## TODOs ##", "- [ ] 1. Implement", "## Final Verification Wave ###", "- [ ] F1. Verify"].join("\n"),
		);

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({
			completed: 0,
			remaining: 2,
			total: 2,
			nextTaskLabel: "1. Implement",
		});
	});

	it("#given inline backtick code before a canonical task #when parsed #then it does not open a fence", () => {
		// given
		const planPath = createPlan(["## TODOs", "```example```", "- [ ] 1. Implement"].join("\n"));

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist.total).toBe(1);
		expect(checklist.nextTaskLabel).toBe("1. Implement");
	});

	it("#given a heading-free fenced checkbox example #when parsed #then legacy fallback ignores it", () => {
		// given
		const planPath = createPlan(["````md", "- [ ] 1. Example only", "````"].join("\n"));

		// when
		const checklist = getPlanChecklist(planPath);

		// then
		expect(checklist).toEqual({
			completed: 0,
			remaining: 0,
			total: 0,
			nextTaskLabel: null,
		});
	});
});

describe("start-work boulder state reader", () => {
	it("#given active codex work with remaining checklist #when state is read #then continuation fields match baseline", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ status: "active", sessionIds: ["codex:sess_abc"] }),
			planMarkdown: SCAFFOLD_PLAN_MARKDOWN,
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
			checklist: {
				completed: 2,
				remaining: 2,
				total: 4,
				nextTaskLabel: "1. Implement checklist parser parity",
			},
		});
	});

	it("#given completed codex work #when state is read #then continuation is absent", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ status: "completed", sessionIds: ["codex:sess_abc"] }),
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] 1. First\n",
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
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] 1. First\n",
		});

		// when
		const state = readContinuationState(workspace, "sess_abc");

		// then
		expect(state?.planName).toBe("launch-plan");
		expect(state?.checklist).toEqual({ completed: 0, remaining: 1, total: 1, nextTaskLabel: "1. First" });
	});

	it("#given active codex work with no remaining checklist items #when state is read #then final gate continuation remains present", () => {
		// given
		const workspace = createWorkspace({
			boulderJson: createBoulderJson({ status: "active", sessionIds: ["codex:sess_abc"] }),
			planMarkdown: "# Plan\n\n## TODOs\n- [x] 1. First\n",
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
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] 1. First\n",
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
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] 1. First\n",
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
			planMarkdown: "# Plan\n\n## TODOs\n- [ ] 1. First\n",
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
