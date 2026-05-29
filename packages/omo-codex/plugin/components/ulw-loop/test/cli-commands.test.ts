import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.ts";
import { ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE } from "../src/goal-status.js";

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
	return JSON.stringify({ goal: { objective: ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE, status } });
}

async function createPlan(brief = "- Goal A\n- Goal B"): Promise<Record<string, unknown>> {
	resetOutput();
	expect(await ulwLoopCommand(["create-goals", "--brief", brief, "--json"])).toBe(0);
	const parsed = stdoutJson();
	resetOutput();
	return parsed;
}

async function passCriterion(goalId: string, criterionId: string): Promise<void> {
	expect(
		await ulwLoopCommand([
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

describe("ulwLoopCommand help", () => {
	it("prints usage when no subcommand", async () => {
		expect(await ulwLoopCommand([])).toBe(0);
		expect(out.join("")).toContain("omo ulw-loop");
	});
});

describe("ulwLoopCommand create-goals", () => {
	it("creates plan + writes 3 artifacts + seeds criteria per goal", async () => {
		const code = await ulwLoopCommand(["create-goals", "--brief", "- Goal A\n- Goal B", "--json"]);

		expect(code).toBe(0);
		const parsed = stdoutJson();
		expect(parsed).toMatchObject({ ok: true });
		expect(parsed).toHaveProperty("plan.goals.0.successCriteria.0.id", "C001");
		expect(await readFile(join(testDir, ".omo/ulw-loop/brief.md"), "utf8")).toContain("Goal A");
		expect(await readFile(join(testDir, ".omo/ulw-loop/goals.json"), "utf8")).toContain("successCriteria");
		expect(await readFile(join(testDir, ".omo/ulw-loop/ledger.jsonl"), "utf8")).toContain("plan_created");
	});
});

describe("ulwLoopCommand status", () => {
	it("prints plan summary including criteria counts", async () => {
		await createPlan();

		expect(await ulwLoopCommand(["status"])).toBe(0);
		expect(out.join("")).toContain("criteria: 0/6 pass");
	});
});

describe("ulwLoopCommand complete-goals", () => {
	it("starts the next goal and returns a Codex instruction", async () => {
		await createPlan();

		expect(await ulwLoopCommand(["complete-goals", "--json"])).toBe(0);
		expect(stdoutJson()).toMatchObject({
			ok: true,
			goal: { status: "in_progress" },
			instruction: { json: { status: "active" } },
		});
	});
});

describe("ulwLoopCommand record-evidence", () => {
	it("records evidence + returns updated criterion", async () => {
		await createPlan();

		expect(
			await ulwLoopCommand([
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
			await ulwLoopCommand([
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
		expect(err.join("")).toContain("[ulw-loop]");
	});

	it("returns 1 + error on missing flags", async () => {
		expect(
			await ulwLoopCommand(["record-evidence", "--criterion-id", "C001", "--status", "pass", "--evidence", "x"]),
		).toBe(1);
		expect(err.join("")).toContain("Missing --goal-id");
	});
});

describe("ulwLoopCommand criteria", () => {
	it("lists criteria for a goal", async () => {
		await createPlan();

		expect(await ulwLoopCommand(["criteria", "--goal-id", "G001-goal-a"])).toBe(0);
		expect(out.join("")).toContain("C001");
		expect(out.join("")).toContain("happy");
	});

	it("supports --json output", async () => {
		await createPlan();

		expect(await ulwLoopCommand(["criteria", "--goal-id", "G001-goal-a", "--json"])).toBe(0);
		expect(stdoutJson()).toMatchObject({ ok: true, goalId: "G001-goal-a" });
		expect(stdoutJson()).toHaveProperty("criteria.0.id", "C001");
	});
});

describe("ulwLoopCommand checkpoint", () => {
	it("REJECTS status=complete when criteria pending", async () => {
		await createPlan();

		expect(
			await ulwLoopCommand([
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
			await ulwLoopCommand([
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

describe("ulwLoopCommand steer", () => {
	it("dispatches to the steering engine", async () => {
		await createPlan();

		expect(
			await ulwLoopCommand([
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

describe("ulwLoopCommand add-goal", () => {
	it("appends a pending goal", async () => {
		await createPlan();

		expect(await ulwLoopCommand(["add-goal", "--title", "Later", "--objective", "Do later", "--json"])).toBe(0);
		expect(stdoutJson()).toMatchObject({ ok: true, goal: { title: "Later", status: "pending" } });
	});
});

describe("ulwLoopCommand unknown", () => {
	it("returns 1 + prints help on unknown subcommand", async () => {
		expect(await ulwLoopCommand(["wat"])).toBe(1);
		expect(out.join("")).toContain("omo ulw-loop");
	});
});

describe("ulwLoopCommand error handling", () => {
	it("returns 1 + prints [ulw-loop] prefix on UlwLoopError", async () => {
		expect(await ulwLoopCommand(["status"])).toBe(1);
		expect(err.join("")).toContain("[ulw-loop]");
	});
});
