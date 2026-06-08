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
import type { SteerUlwLoopResult, UlwLoopPlan } from "../src/types.js";
import { UlwLoopError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";
const REVISE_CRITERION_BASE_ARGS = [
	"--kind",
	"revise_criterion",
	"--goal-id",
	"G001",
	"--criterion-id",
	"C002",
] as const;
const REQUIRED_AUDIT_ARGS = ["--evidence", "x", "--rationale", "y"] as const;

function plan(): UlwLoopPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		goals: [],
	};
}

function steerResult(overrides: Partial<SteerUlwLoopResult> = {}): SteerUlwLoopResult {
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
	for (const testCase of [
		{ name: "returns valid kind from --kind", args: ["--kind", "add_subgoal"], expected: "add_subgoal" },
		{ name: "accepts revise_criterion", args: ["--kind", "revise_criterion"], expected: "revise_criterion" },
	] as const) {
		it(testCase.name, () => {
			expect(parseSteeringKind(testCase.args)).toBe(testCase.expected);
		});
	}

	for (const testCase of [
		{ name: "throws when --kind missing", args: [] },
		{ name: "throws when kind unknown", args: ["--kind", "bogus"] },
	] as const) {
		it(testCase.name, () => {
			expect(() => parseSteeringKind(testCase.args)).toThrow(UlwLoopError);
		});
	}
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
		).rejects.toThrow(UlwLoopError);
	});

	it("throws when --evidence missing", async () => {
		await expect(
			parseSteeringProposal(["--kind", "add_subgoal", "--title", "New", "--objective", "Build", "--rationale", "y"]),
		).rejects.toThrow(UlwLoopError);
	});
});

describe("parseSteeringProposal revise_criterion", () => {
	it("builds proposal with goal, criterion, scenario, evidence, and rationale", async () => {
		const p = await parseSteeringProposal([
			...REVISE_CRITERION_BASE_ARGS,
			"--scenario",
			"new scenario",
			...REQUIRED_AUDIT_ARGS,
		]);

		expect(p.kind).toBe("revise_criterion");
		expect(p.goalId).toBe("G001");
		expect(p.targetGoalId).toBe("G001");
		expect(p.criterionId).toBe("C002");
		expect(p.scenario).toBe("new scenario");
	});

	for (const testCase of [
		{
			name: "accepts --expected-evidence as an update field",
			updateArgs: ["--expected-evidence", "new evidence"],
			expected: { expectedEvidence: "new evidence" },
		},
		{
			name: "accepts --user-model as an update field",
			updateArgs: ["--user-model", "edge"],
			expected: { userModel: "edge" },
		},
	] as const) {
		it(testCase.name, async () => {
			const p = await parseSteeringProposal([
				...REVISE_CRITERION_BASE_ARGS,
				...testCase.updateArgs,
				...REQUIRED_AUDIT_ARGS,
			]);

			expect(p).toMatchObject(testCase.expected);
		});
	}

	for (const testCase of [
		{
			name: "throws when none of scenario/expected-evidence/user-model provided",
			args: [...REVISE_CRITERION_BASE_ARGS, ...REQUIRED_AUDIT_ARGS],
		},
		{
			name: "throws when goal-id missing",
			args: ["--kind", "revise_criterion", "--criterion-id", "C002", "--scenario", "s", ...REQUIRED_AUDIT_ARGS],
		},
		{
			name: "throws when criterion-id missing",
			args: ["--kind", "revise_criterion", "--goal-id", "G001", "--scenario", "s", ...REQUIRED_AUDIT_ARGS],
		},
	] as const) {
		it(testCase.name, async () => {
			await expect(parseSteeringProposal(testCase.args)).rejects.toThrow(UlwLoopError);
		});
	}
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
		).toThrow(UlwLoopError);
	});
});

describe("printSteerResult", () => {
	it("prints JSON when json=true", () => {
		const output = captureStdout(() => printSteerResult(steerResult(), true));

		expect(JSON.parse(output)).toMatchObject({ accepted: true, deduped: false, audit: { kind: "add_subgoal" } });
	});

	it("prints human-readable when json=false", () => {
		const output = captureStdout(() => printSteerResult(steerResult(), false));

		expect(output).toContain("ulw-loop steer: accepted add_subgoal");
		expect(output).toContain("ulw-loop status");
	});
});
