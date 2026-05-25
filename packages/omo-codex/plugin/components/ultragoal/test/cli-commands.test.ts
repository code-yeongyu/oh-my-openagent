import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ultragoalCommand } from "../src/cli-commands.ts";
import { ULTRAGOAL_AGGREGATE_CODEX_OBJECTIVE } from "../src/goal-status.js";

let testDir: string;
let out: string[];
let err: string[];

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-"));
	out = [];
	err = [];
	vi.spyOn(process, "cwd").mockReturnValue(testDir);
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		out.push(chunk.toString());
		return true;
	});
	vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		err.push(chunk.toString());
		return true;
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(testDir, { recursive: true, force: true });
});

function resetOutput(): void {
	out = [];
	err = [];
}
function stdoutJson(): Record<string, unknown> {
	return JSON.parse(out.join(""));
}
function codexSnapshot(status: "active" | "complete" = "active"): string {
	return JSON.stringify({ goal: { objective: ULTRAGOAL_AGGREGATE_CODEX_OBJECTIVE, status } });
}

async function createPlan(brief = "- Goal A\n- Goal B"): Promise<Record<string, unknown>> {
	resetOutput();
	expect(await ultragoalCommand(["create-goals", "--brief", brief, "--json"])).toBe(0);
	const parsed = stdoutJson();
	resetOutput();
	return parsed;
}

async function passCriterion(goalId: string, criterionId: string): Promise<void> {
	expect(
		await ultragoalCommand([
			"record-evidence",
			"--goal-id",
			goalId,
			"--criterion-id",
			criterionId,
			"--status",
			"pass",
			"--evidence",
			`${criterionId} observable proof`,
		]),
	).toBe(0);
	resetOutput();
}

describe("ultragoalCommand help", () => {
	it("prints usage when no subcommand", async () => {
		expect(await ultragoalCommand([])).toBe(0);
		expect(out.join("")).toContain("omo ultragoal");
	});
});

describe("ultragoalCommand create-goals", () => {
	it("creates plan + writes 3 artifacts + seeds criteria per goal", async () => {
		const code = await ultragoalCommand(["create-goals", "--brief", "- Goal A\n- Goal B", "--json"]);

		expect(code).toBe(0);
		const parsed = stdoutJson();
		expect(parsed).toMatchObject({ ok: true });
		expect(parsed).toHaveProperty("plan.goals.0.successCriteria.0.id", "C001");
		expect(await readFile(join(testDir, ".omo/ultragoal/brief.md"), "utf8")).toContain("Goal A");
		expect(await readFile(join(testDir, ".omo/ultragoal/goals.json"), "utf8")).toContain("successCriteria");
		expect(await readFile(join(testDir, ".omo/ultragoal/ledger.jsonl"), "utf8")).toContain("plan_created");
	});
});

describe("ultragoalCommand status", () => {
	it("prints plan summary including criteria counts", async () => {
		await createPlan();

		expect(await ultragoalCommand(["status"])).toBe(0);
		expect(out.join("")).toContain("criteria: 0/6 pass");
	});
});

describe("ultragoalCommand complete-goals", () => {
	it("starts the next goal and returns a Codex instruction", async () => {
		await createPlan();

		expect(await ultragoalCommand(["complete-goals", "--json"])).toBe(0);
		expect(stdoutJson()).toMatchObject({
			ok: true,
			goal: { status: "in_progress" },
			instruction: { json: { status: "active" } },
		});
	});
});

describe("ultragoalCommand record-evidence", () => {
	it("records evidence + returns updated criterion", async () => {
		await createPlan();

		expect(
			await ultragoalCommand([
				"record-evidence",
				"--goal-id",
				"G001-goal-a",
				"--criterion-id",
				"C001",
				"--status",
				"pass",
				"--evidence",
				"curl passed",
				"--json",
			]),
		).toBe(0);
		expect(stdoutJson()).toMatchObject({
			ok: true,
			criterion: { id: "C001", status: "pass", capturedEvidence: "curl passed" },
		});
	});

	it("returns 1 + error on unknown goal-id", async () => {
		await createPlan();

		expect(
			await ultragoalCommand([
				"record-evidence",
				"--goal-id",
				"G404",
				"--criterion-id",
				"C001",
				"--status",
				"pass",
				"--evidence",
				"x",
			]),
		).toBe(1);
		expect(err.join("")).toContain("[ultragoal]");
	});

	it("returns 1 + error on missing flags", async () => {
		expect(
			await ultragoalCommand(["record-evidence", "--criterion-id", "C001", "--status", "pass", "--evidence", "x"]),
		).toBe(1);
		expect(err.join("")).toContain("Missing --goal-id");
	});
});

describe("ultragoalCommand criteria", () => {
	it("lists criteria for a goal", async () => {
		await createPlan();

		expect(await ultragoalCommand(["criteria", "--goal-id", "G001-goal-a"])).toBe(0);
		expect(out.join("")).toContain("C001");
		expect(out.join("")).toContain("happy");
	});

	it("supports --json output", async () => {
		await createPlan();

		expect(await ultragoalCommand(["criteria", "--goal-id", "G001-goal-a", "--json"])).toBe(0);
		expect(stdoutJson()).toMatchObject({ ok: true, goalId: "G001-goal-a" });
		expect(stdoutJson()).toHaveProperty("criteria.0.id", "C001");
	});
});

describe("ultragoalCommand checkpoint", () => {
	it("REJECTS status=complete when criteria pending", async () => {
		await createPlan();

		expect(
			await ultragoalCommand([
				"checkpoint",
				"--goal-id",
				"G001-goal-a",
				"--status",
				"complete",
				"--evidence",
				"x",
				"--codex-goal-json",
				codexSnapshot(),
			]),
		).toBe(1);
		expect(err.join("").toLowerCase()).toContain("criteria");
	});

	it("ACCEPTS when all criteria pass", async () => {
		await createPlan();
		await passCriterion("G001-goal-a", "C001");
		await passCriterion("G001-goal-a", "C002");
		await passCriterion("G001-goal-a", "C003");

		expect(
			await ultragoalCommand([
				"checkpoint",
				"--goal-id",
				"G001-goal-a",
				"--status",
				"complete",
				"--evidence",
				"implementation done and validation passed",
				"--codex-goal-json",
				codexSnapshot(),
				"--json",
			]),
		).toBe(0);
		expect(stdoutJson()).toHaveProperty("goal.status", "complete");
	});
});

describe("ultragoalCommand steer", () => {
	it("dispatches to the steering engine", async () => {
		await createPlan();

		expect(
			await ultragoalCommand([
				"steer",
				"--kind",
				"add_subgoal",
				"--title",
				"Extra",
				"--objective",
				"Do extra",
				"--evidence",
				"user requested it",
				"--rationale",
				"keeps plan accurate",
				"--json",
			]),
		).toBe(0);
		expect(stdoutJson()).toMatchObject({
			ok: true,
			accepted: true,
			plan: { goals: [{ id: "G001-goal-a" }, { id: "G002-goal-b" }, { title: "Extra" }] },
		});
	});
});

describe("ultragoalCommand add-goal", () => {
	it("appends a pending goal", async () => {
		await createPlan();

		expect(await ultragoalCommand(["add-goal", "--title", "Later", "--objective", "Do later", "--json"])).toBe(0);
		expect(stdoutJson()).toMatchObject({ ok: true, goal: { title: "Later", status: "pending" } });
	});
});

describe("ultragoalCommand unknown", () => {
	it("returns 1 + prints help on unknown subcommand", async () => {
		expect(await ultragoalCommand(["wat"])).toBe(1);
		expect(out.join("")).toContain("omo ultragoal");
	});
});

describe("ultragoalCommand error handling", () => {
	it("returns 1 + prints [ultragoal] prefix on UltragoalError", async () => {
		expect(await ultragoalCommand(["status"])).toBe(1);
		expect(err.join("")).toContain("[ultragoal]");
	});
});
