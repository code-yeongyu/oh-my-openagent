import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ulwLoopGoalsPath } from "../src/paths.js";
import { readSteeringLedgerEntries, readUlwLoopPlan, writePlan } from "../src/plan-io.js";
import {
	applySteeringMutation,
	parseUlwLoopSteeringDirective,
	steerUlwLoop,
	validateUlwLoopSteeringProposal,
} from "../src/steering.js";
import type {
	UlwLoopItem,
	UlwLoopPlan,
	UlwLoopSteeringProposal,
	UlwLoopSuccessCriterion,
	UlwLoopSuccessCriterionUserModel,
} from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

type CriterionSteeringFields = {
	readonly goalId?: string;
	readonly scenario?: string;
	readonly expectedEvidence?: string;
	readonly userModel?: UlwLoopSuccessCriterionUserModel;
};
type SteeringInput = UlwLoopSteeringProposal & CriterionSteeringFields;

function criterion(overrides: Partial<UlwLoopSuccessCriterion> = {}): UlwLoopSuccessCriterion {
	return {
		id: "C001",
		scenario: "old scenario",
		userModel: "happy",
		expectedEvidence: "vague evidence",
		capturedEvidence: null,
		status: "pending",
		...overrides,
	};
}

function goal(overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return {
		id: "G001",
		title: "Build auth service",
		objective: "Implement JWT auth endpoint",
		status: "pending",
		successCriteria: [criterion(), criterion({ id: "C002", status: "pass" })],
		attempt: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function plan(overrides: Partial<UlwLoopPlan> = {}): UlwLoopPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		goals: [
			goal(),
			goal({ id: "G002", title: "Rate limit", objective: "Throttle login" }),
			goal({ id: "G003", status: "complete" }),
		],
		...overrides,
	};
}

function steering(overrides: Partial<SteeringInput> = {}): SteeringInput {
	return {
		kind: "add_subgoal",
		source: "cli",
		evidence: "observable blocker evidence",
		rationale: "the plan must change to stay safe",
		title: "Investigate auth blocker",
		objective: "Validate the blocker, capture evidence, and report findings.",
		...overrides,
	};
}

async function repoWithPlan(seed: UlwLoopPlan = plan()): Promise<string> {
	const repoRoot = await mkdtemp(join(tmpdir(), "ug-steer-"));
	await writePlan(repoRoot, seed);
	return repoRoot;
}

describe("validateUlwLoopSteeringProposal", () => {
	it("accepts valid add_subgoal", async () => {
		const proposal: unknown = JSON.parse(
			await readFile(join(process.cwd(), "test/fixtures/steering-proposal.json"), "utf8"),
		);
		expect(validateUlwLoopSteeringProposal(plan(), proposal).invariant.accepted).toBe(true);
	});

	it.each([
		["missing evidence", { evidence: "" }],
		["missing rationale", { rationale: "" }],
		["unknown kind", { kind: "teleport_goal" }],
		["protected payload mutations", { after: { codexObjective: "replace", qualityGate: { status: "passed" } } }],
		["weakened completion text", { objective: "skip tests and mark complete faster" }],
	])("rejects %s", (_name, overrides) => {
		const audit = validateUlwLoopSteeringProposal(plan(), { ...steering(), ...overrides });
		expect(audit.invariant.accepted).toBe(false);
		expect(audit.invariant.rejectedReasons.length).toBeGreaterThan(0);
	});

	it("rejects when plan already complete", () => {
		const done = plan({ goals: [goal({ status: "complete" }), goal({ id: "G002", status: "complete" })] });
		expect(validateUlwLoopSteeringProposal(done, steering()).invariant.accepted).toBe(false);
	});

	it("rejects split_subgoal without children", () => {
		const audit = validateUlwLoopSteeringProposal(plan(), steering({ kind: "split_subgoal", targetGoalId: "G001" }));
		expect(audit.invariant.accepted).toBe(false);
	});

	it("rejects reorder_pending with unknown goal id", () => {
		const audit = validateUlwLoopSteeringProposal(
			plan(),
			steering({ kind: "reorder_pending", pendingOrder: ["missing"] }),
		);
		expect(audit.invariant.accepted).toBe(false);
	});

	it.each([
		["new scenario", { scenario: "new precise scenario" }],
		["new expectedEvidence", { expectedEvidence: "specific command output" }],
	])("accepts valid revise_criterion with %s", (_name, update) => {
		const audit = validateUlwLoopSteeringProposal(
			plan(),
			steering({ kind: "revise_criterion", goalId: "G001", criterionId: "C001", ...update }),
		);
		expect(audit.invariant.accepted).toBe(true);
	});

	it.each([
		["unknown goalId", { goalId: "missing", criterionId: "C001", scenario: "new" }],
		["unknown criterionId", { goalId: "G001", criterionId: "missing", scenario: "new" }],
		["no updates", { goalId: "G001", criterionId: "C001" }],
	])("rejects revise_criterion with %s", (_name, overrides) => {
		const audit = validateUlwLoopSteeringProposal(plan(), steering({ kind: "revise_criterion", ...overrides }));
		expect(audit.invariant.accepted).toBe(false);
	});
});

describe("steerUlwLoop", () => {
	describe("steering-created goals", () => {
		function sluggedPlan(): UlwLoopPlan {
			return plan({
				goals: [
					goal({ id: "G001-goal-a", title: "Goal A", objective: "Do A" }),
					goal({ id: "G002-goal-b", title: "Goal B", objective: "Do B" }),
				],
			});
		}

		it("add_subgoal: uses next numeric id + default success criteria", async () => {
			const repoRoot = await repoWithPlan(sluggedPlan());
			const result = await steerUlwLoop(repoRoot, steering({ idempotencyKey: "slug-add" }));
			expect(result.plan.goals.at(-1)).toMatchObject({
				id: "G003",
				successCriteria: [{ id: "C001" }, { id: "C002" }, { id: "C003" }],
			});
		});

		it("split_subgoal: replacement goals use default success criteria", async () => {
			const repoRoot = await repoWithPlan(sluggedPlan());
			const result = await steerUlwLoop(
				repoRoot,
				steering({
					kind: "split_subgoal",
					targetGoalId: "G001-goal-a",
					childGoals: [{ title: "Child A", objective: "Do child A" }],
				}),
			);
			expect(result.plan.goals[1]).toMatchObject({
				id: "G003",
				successCriteria: [{ id: "C001" }, { id: "C002" }, { id: "C003" }],
			});
		});

		it("mark_blocked_superseded: replacement goals use default success criteria", async () => {
			const repoRoot = await repoWithPlan(sluggedPlan());
			const result = await steerUlwLoop(
				repoRoot,
				steering({
					kind: "mark_blocked_superseded",
					targetGoalId: "G001-goal-a",
					childGoals: [{ title: "Replacement", objective: "Replace blocked path" }],
				}),
			);
			expect(result.plan.goals[1]).toMatchObject({
				id: "G003",
				successCriteria: [{ id: "C001" }, { id: "C002" }, { id: "C003" }],
			});
		});
	});

	it("add_subgoal: appends goal + ledger entry", async () => {
		const repoRoot = await repoWithPlan();
		const result = await steerUlwLoop(repoRoot, steering({ idempotencyKey: "add" }));
		const persisted = await readUlwLoopPlan(repoRoot);
		expect(result.accepted).toBe(true);
		expect(persisted.goals.at(-1)).toMatchObject({ id: "G004", title: "Investigate auth blocker" });
		expect((await readSteeringLedgerEntries(repoRoot)).at(-1)).toMatchObject({
			kind: "steering_accepted",
			mutationKind: "add_subgoal",
		});
	});

	it("split_subgoal: creates children + supersedes parent", async () => {
		const repoRoot = await repoWithPlan();
		const result = await steerUlwLoop(
			repoRoot,
			steering({
				kind: "split_subgoal",
				targetGoalId: "G001",
				childGoals: [{ title: "Child", objective: "Do child" }],
			}),
		);
		expect(result.plan.goals.map((item) => item.id).slice(0, 2)).toEqual(["G001", "G004"]);
		expect(result.plan.goals[0]).toMatchObject({ steeringStatus: "superseded", supersededBy: ["G004"] });
	});

	it("reorder_pending: changes goal order", async () => {
		const repoRoot = await repoWithPlan();
		const result = await steerUlwLoop(
			repoRoot,
			steering({ kind: "reorder_pending", pendingOrder: ["G002", "G001"] }),
		);
		expect(result.plan.goals.map((item) => item.id).slice(0, 2)).toEqual(["G002", "G001"]);
	});

	it("revise_pending_wording: updates title/objective", async () => {
		const repoRoot = await repoWithPlan();
		const result = await steerUlwLoop(
			repoRoot,
			steering({
				kind: "revise_pending_wording",
				targetGoalId: "G001",
				revisedTitle: "Build safer auth",
				revisedObjective: "Implement guarded JWT auth",
			}),
		);
		expect(result.plan.goals[0]).toMatchObject({
			title: "Build safer auth",
			objective: "Implement guarded JWT auth",
		});
	});

	it("annotate_ledger: ledger-only, no plan mutation", async () => {
		const seed = plan();
		const repoRoot = await repoWithPlan(seed);
		const result = await steerUlwLoop(repoRoot, steering({ kind: "annotate_ledger" }));
		expect(result.plan.goals).toEqual(seed.goals);
		expect(await readFile(ulwLoopGoalsPath(repoRoot), "utf8")).toBe(`${JSON.stringify(seed, null, 2)}\n`);
	});

	it("mark_blocked_superseded with children: supersede + replace", async () => {
		const repoRoot = await repoWithPlan();
		const result = await steerUlwLoop(
			repoRoot,
			steering({
				kind: "mark_blocked_superseded",
				targetGoalId: "G001",
				childGoals: [{ title: "Replacement", objective: "Replace blocked path" }],
			}),
		);
		expect(result.plan.goals[0]).toMatchObject({ steeringStatus: "superseded", supersededBy: ["G004"] });
		expect(result.plan.goals[1]).toMatchObject({ id: "G004", supersedes: ["G001"] });
	});

	it("mark_blocked_superseded without children: blocks goal", async () => {
		const repoRoot = await repoWithPlan();
		const result = await steerUlwLoop(
			repoRoot,
			steering({ kind: "mark_blocked_superseded", targetGoalId: "G001", blockedReason: "external blocker" }),
		);
		expect(result.plan.goals[0]).toMatchObject({
			status: "blocked",
			steeringStatus: "blocked",
			blockedReason: "external blocker",
		});
	});

	it.each(["pending", "pass"] as const)("revise_criterion: works on a %s criterion", async (status) => {
		const repoRoot = await repoWithPlan();
		const criterionId = status === "pending" ? "C001" : "C002";
		const result = await steerUlwLoop(
			repoRoot,
			steering({
				kind: "revise_criterion",
				goalId: "G001",
				criterionId,
				scenario: "new scenario",
				expectedEvidence: "precise evidence",
			}),
		);
		const updated = result.plan.goals[0]?.successCriteria.find((item) => item.id === criterionId);
		expect(updated).toMatchObject({ scenario: "new scenario", expectedEvidence: "precise evidence", status });
		expect((await readSteeringLedgerEntries(repoRoot)).at(-1)).toMatchObject({
			kind: "criteria_revised",
			criterionId,
		});
	});

	it("revise_criterion: updates the targeted criterion in plan", () => {
		const audit = validateUlwLoopSteeringProposal(
			plan(),
			steering({ kind: "revise_criterion", goalId: "G001", criterionId: "C001", scenario: "new value" }),
		);
		const next = applySteeringMutation(
			plan(),
			steering({ kind: "revise_criterion", goalId: "G001", criterionId: "C001", scenario: "new value" }),
			audit,
		);
		expect(next.goals[0]?.successCriteria[0]?.scenario).toBe("new value");
	});

	it("idempotency: same idempotencyKey produces deduped true second time", async () => {
		const repoRoot = await repoWithPlan();
		await steerUlwLoop(repoRoot, steering({ idempotencyKey: "same-key" }));
		const second = await steerUlwLoop(repoRoot, steering({ idempotencyKey: "same-key" }));
		expect(second.deduped).toBe(true);
		expect((await readUlwLoopPlan(repoRoot)).goals).toHaveLength(4);
	});
});

describe("parseUlwLoopSteeringDirective", () => {
	it.each(["OMO_ULW_LOOP_STEER", "omo.ulw-loop.steer", "omo ulw-loop steer"])("parses %s pattern", (marker) => {
		expect(parseUlwLoopSteeringDirective(`${marker}: ${JSON.stringify(steering())}`)).toMatchObject({
			kind: "add_subgoal",
		});
	});

	it("returns null when no marker", () => {
		expect(parseUlwLoopSteeringDirective(JSON.stringify(steering()))).toBeNull();
	});

	it("returns null when JSON malformed after marker", () => {
		expect(parseUlwLoopSteeringDirective("OMO_ULW_LOOP_STEER: {bad json")).toBeNull();
	});

	it("returns null for deprecated markers", () => {
		const marker = ["OM", "X_ULW_LOOP_STEER"].join("");
		expect(parseUlwLoopSteeringDirective(`${marker}: ${JSON.stringify(steering())}`)).toBeNull();
	});
});
