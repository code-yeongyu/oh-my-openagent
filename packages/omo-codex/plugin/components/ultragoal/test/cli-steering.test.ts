import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
	normalizeSteeringProposal,
	parseSteeringKind,
	parseSteeringProposal,
	parseSteeringSource,
	printSteerResult,
} from "../src/cli-steering.js";
import type { SteerUltragoalResult, UltragoalPlan } from "../src/types.js";
import { UltragoalError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

function plan(): UltragoalPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ultragoal/brief.md",
		goalsPath: ".omo/ultragoal/goals.json",
		ledgerPath: ".omo/ultragoal/ledger.jsonl",
		goals: [],
	};
}

function steerResult(overrides: Partial<SteerUltragoalResult> = {}): SteerUltragoalResult {
	return {
		plan: plan(),
		accepted: true,
		audit: {
			kind: "add_subgoal",
			source: "cli",
			targetGoalIds: ["G001"],
			evidence: "x",
			rationale: "y",
			invariant: {
				accepted: true,
				structuralInvariantAccepted: true,
				evidenceBackedNecessity: true,
				noEasierCompletion: true,
				rejectedReasons: [],
			},
		},
		rejectedReasons: [],
		deduped: false,
		...overrides,
	};
}

function captureStdout(action: () => void): string {
	let output = "";
	const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		output += chunk.toString();
		return true;
	});
	action();
	write.mockRestore();
	return output;
}

describe("parseSteeringKind", () => {
	it("returns valid kind from --kind", () => {
		expect(parseSteeringKind(["--kind", "add_subgoal"])).toBe("add_subgoal");
	});

	it("accepts revise_criterion", () => {
		expect(parseSteeringKind(["--kind", "revise_criterion"])).toBe("revise_criterion");
	});

	it("throws when --kind missing", () => {
		expect(() => parseSteeringKind([])).toThrow(UltragoalError);
	});

	it("throws when kind unknown", () => {
		expect(() => parseSteeringKind(["--kind", "bogus"])).toThrow(UltragoalError);
	});
});

describe("parseSteeringSource", () => {
	it("defaults to cli", () => {
		expect(parseSteeringSource([])).toBe("cli");
	});

	it("returns explicit value", () => {
		expect(parseSteeringSource(["--source", "user_prompt_submit"])).toBe("user_prompt_submit");
	});
});

describe("parseSteeringProposal add_subgoal", () => {
	it("builds proposal from required flags", async () => {
		const p = await parseSteeringProposal([
			"--kind",
			"add_subgoal",
			"--title",
			" New ",
			"--objective",
			" Build ",
			"--evidence",
			" x ",
			"--rationale",
			" y ",
		]);

		expect(p).toMatchObject({
			kind: "add_subgoal",
			source: "cli",
			title: "New",
			objective: "Build",
			evidence: "x",
			rationale: "y",
		});
	});

	it("throws when --title missing", async () => {
		await expect(
			parseSteeringProposal([
				"--kind",
				"add_subgoal",
				"--objective",
				"Build",
				"--evidence",
				"x",
				"--rationale",
				"y",
			]),
		).rejects.toThrow(UltragoalError);
	});

	it("throws when --evidence missing", async () => {
		await expect(
			parseSteeringProposal(["--kind", "add_subgoal", "--title", "New", "--objective", "Build", "--rationale", "y"]),
		).rejects.toThrow(UltragoalError);
	});
});

describe("parseSteeringProposal revise_criterion", () => {
	it("builds proposal with goal, criterion, scenario, evidence, and rationale", async () => {
		const p = await parseSteeringProposal([
			"--kind",
			"revise_criterion",
			"--goal-id",
			"G001",
			"--criterion-id",
			"C002",
			"--scenario",
			"new scenario",
			"--evidence",
			"x",
			"--rationale",
			"y",
		]);

		expect(p.kind).toBe("revise_criterion");
		expect(p.goalId).toBe("G001");
		expect(p.targetGoalId).toBe("G001");
		expect(p.criterionId).toBe("C002");
		expect(p.scenario).toBe("new scenario");
	});

	it("accepts --expected-evidence as an update field", async () => {
		const p = await parseSteeringProposal([
			"--kind",
			"revise_criterion",
			"--goal-id",
			"G001",
			"--criterion-id",
			"C002",
			"--expected-evidence",
			"new evidence",
			"--evidence",
			"x",
			"--rationale",
			"y",
		]);

		expect(p.expectedEvidence).toBe("new evidence");
	});

	it("accepts --user-model as an update field", async () => {
		const p = await parseSteeringProposal([
			"--kind",
			"revise_criterion",
			"--goal-id",
			"G001",
			"--criterion-id",
			"C002",
			"--user-model",
			"edge",
			"--evidence",
			"x",
			"--rationale",
			"y",
		]);

		expect(p.userModel).toBe("edge");
	});

	it("throws when none of scenario/expected-evidence/user-model provided", async () => {
		await expect(
			parseSteeringProposal([
				"--kind",
				"revise_criterion",
				"--goal-id",
				"G001",
				"--criterion-id",
				"C002",
				"--evidence",
				"x",
				"--rationale",
				"y",
			]),
		).rejects.toThrow(UltragoalError);
	});

	it("throws when goal-id missing", async () => {
		await expect(
			parseSteeringProposal([
				"--kind",
				"revise_criterion",
				"--criterion-id",
				"C002",
				"--scenario",
				"s",
				"--evidence",
				"x",
				"--rationale",
				"y",
			]),
		).rejects.toThrow(UltragoalError);
	});

	it("throws when criterion-id missing", async () => {
		await expect(
			parseSteeringProposal([
				"--kind",
				"revise_criterion",
				"--goal-id",
				"G001",
				"--scenario",
				"s",
				"--evidence",
				"x",
				"--rationale",
				"y",
			]),
		).rejects.toThrow(UltragoalError);
	});
});

describe("parseSteeringProposal split_subgoal", () => {
	it("reads --children from inline JSON", async () => {
		const p = await parseSteeringProposal([
			"--kind",
			"split_subgoal",
			"--goal-id",
			"G001",
			"--children",
			'[{"title":"A","objective":"Do A"}]',
			"--evidence",
			"x",
			"--rationale",
			"y",
		]);

		expect(p.childGoals).toEqual([{ title: "A", objective: "Do A" }]);
	});

	it("reads --children from JSON file path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ug-steer-"));
		try {
			const file = join(dir, "children.json");
			await writeFile(file, '[{"title":"B","objective":"Do B"}]', "utf8");

			const p = await parseSteeringProposal([
				"--kind",
				"split_subgoal",
				"--goal-id",
				"G001",
				"--children",
				file,
				"--evidence",
				"x",
				"--rationale",
				"y",
			]);

			expect(p.childGoals).toEqual([{ title: "B", objective: "Do B" }]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("parseSteeringProposal reorder_pending", () => {
	it("reads --order from inline JSON array", async () => {
		const p = await parseSteeringProposal([
			"--kind",
			"reorder_pending",
			"--order",
			'["G002","G001"]',
			"--evidence",
			"x",
			"--rationale",
			"y",
		]);

		expect(p.pendingOrder).toEqual(["G002", "G001"]);
	});
});

describe("parseSteeringProposal remaining kinds", () => {
	it("builds revise_pending_wording proposal", async () => {
		const p = await parseSteeringProposal([
			"--kind",
			"revise_pending_wording",
			"--goal-id",
			"G001",
			"--title",
			"New",
			"--evidence",
			"x",
			"--rationale",
			"y",
		]);

		expect(p).toMatchObject({ kind: "revise_pending_wording", targetGoalId: "G001", revisedTitle: "New" });
	});

	it("builds mark_blocked_superseded proposal with replacements", async () => {
		const p = await parseSteeringProposal([
			"--kind",
			"mark_blocked_superseded",
			"--goal-id",
			"G001",
			"--replacements",
			'[{"title":"C","objective":"Do C"}]',
			"--evidence",
			"x",
			"--rationale",
			"y",
		]);

		expect(p).toMatchObject({
			kind: "mark_blocked_superseded",
			targetGoalId: "G001",
			childGoals: [{ title: "C", objective: "Do C" }],
		});
	});
});

describe("parseSteeringProposal annotate_ledger", () => {
	it("builds minimal proposal", async () => {
		const p = await parseSteeringProposal(["--kind", "annotate_ledger", "--evidence", "x", "--rationale", "y"]);

		expect(p).toMatchObject({ kind: "annotate_ledger", source: "cli", evidence: "x", rationale: "y" });
	});
});

describe("normalizeSteeringProposal", () => {
	it("trims string fields", () => {
		const p = normalizeSteeringProposal({
			kind: "revise_criterion",
			source: "cli",
			goalId: " G001 ",
			targetGoalId: " G001 ",
			criterionId: " C002 ",
			evidence: " x ",
			rationale: " y ",
			scenario: " z ",
		});

		expect(p).toMatchObject({
			goalId: "G001",
			targetGoalId: "G001",
			criterionId: "C002",
			evidence: "x",
			rationale: "y",
			scenario: "z",
		});
	});

	it("rejects empty evidence after trim", () => {
		expect(() =>
			normalizeSteeringProposal({ kind: "annotate_ledger", source: "cli", evidence: " ", rationale: "y" }),
		).toThrow(UltragoalError);
	});
});

describe("printSteerResult", () => {
	it("prints JSON when json=true", () => {
		const output = captureStdout(() => printSteerResult(steerResult(), true));

		expect(JSON.parse(output)).toMatchObject({ accepted: true, deduped: false, audit: { kind: "add_subgoal" } });
	});

	it("prints human-readable when json=false", () => {
		const output = captureStdout(() => printSteerResult(steerResult(), false));

		expect(output).toContain("ultragoal steer: accepted add_subgoal");
		expect(output).toContain("ultragoal status");
	});
});
