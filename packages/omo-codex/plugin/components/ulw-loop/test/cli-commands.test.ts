import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.ts";

let testDir: string;
let out: string[];
let err: string[];
let originalCodexSessionId: string | undefined;
let originalCodexThreadId: string | undefined;
let originalOmoSessionId: string | undefined;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-"));
	out = [];
	err = [];
	originalCodexSessionId = process.env["CODEX_SESSION_ID"];
	originalCodexThreadId = process.env["CODEX_THREAD_ID"];
	originalOmoSessionId = process.env["OMO_ULW_LOOP_SESSION_ID"];
	delete process.env["CODEX_SESSION_ID"];
	delete process.env["CODEX_THREAD_ID"];
	delete process.env["OMO_ULW_LOOP_SESSION_ID"];
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
	if (originalCodexSessionId === undefined) delete process.env["CODEX_SESSION_ID"];
	else process.env["CODEX_SESSION_ID"] = originalCodexSessionId;
	if (originalCodexThreadId === undefined) delete process.env["CODEX_THREAD_ID"];
	else process.env["CODEX_THREAD_ID"] = originalCodexThreadId;
	if (originalOmoSessionId === undefined) delete process.env["OMO_ULW_LOOP_SESSION_ID"];
	else process.env["OMO_ULW_LOOP_SESSION_ID"] = originalOmoSessionId;
	await rm(testDir, { recursive: true, force: true });
});

function resetOutput(): void {
	out = [];
	err = [];
}
function stdoutJson(): Record<string, unknown> {
	return JSON.parse(out.join(""));
}

async function createPlan(brief = "- Goal A\n- Goal B"): Promise<Record<string, unknown>> {
	resetOutput();
	expect(await ulwLoopCommand(["create-goals", "--brief", brief, "--json"])).toBe(0);
	const parsed = stdoutJson();
	resetOutput();
	return parsed;
}

describe("ulwLoopCommand help", () => {
	it("prints usage when no subcommand", async () => {
		expect(await ulwLoopCommand([])).toBe(0);
		expect(out.join("")).toContain("omo ulw-loop");
	});
});

describe("ulwLoopCommand status", () => {
	it("prints plan summary including criteria counts", async () => {
		await createPlan();

		expect(await ulwLoopCommand(["status"])).toBe(0);
		expect(out.join("")).toContain("criteria: 0/6 pass");
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
			plan: {
				goals: [
					{ id: "G001-goal-a" },
					{ id: "G002-goal-b" },
					{ id: "G003", title: "Extra", successCriteria: [{ id: "C001" }, { id: "C002" }, { id: "C003" }] },
				],
			},
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

	it("#given no --json #when an error occurs #then writes only to stderr and leaves stdout empty", async () => {
		expect(await ulwLoopCommand(["status"])).toBe(1);
		expect(out.join("")).toBe("");
		expect(err.join("")).toContain("[ulw-loop]");
	});
});
