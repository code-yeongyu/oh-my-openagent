import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
	hasFlag,
	parseGoalArg,
	parseRecordEvidenceArgs,
	positionalText,
	readJsonInput,
	readRepeated,
	readValue,
} from "../src/cli-arg-parser.js";
import { normalizeCodexGoalMode, printStatus, ULW_LOOP_HELP } from "../src/cli-output.js";
import type { UlwLoopItem, UlwLoopPlan, UlwLoopSuccessCriterion } from "../src/types.js";
import { UlwLoopError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

function criterion(overrides: Partial<UlwLoopSuccessCriterion> = {}): UlwLoopSuccessCriterion {
	return {
		id: "C001",
		scenario: "happy path returns 200",
		userModel: "happy",
		expectedEvidence: "HTTP 200",
		capturedEvidence: null,
		status: "pending",
		...overrides,
	};
}

function goal(overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return {
		id: "G001",
		title: "Auth endpoint",
		objective: "Build JWT auth",
		status: "in_progress",
		successCriteria: [
			criterion({ id: "C001", status: "pass" }),
			criterion({ id: "C002", status: "pass" }),
			criterion({ id: "C003" }),
		],
		attempt: 1,
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
		activeGoalId: "G001",
		goals: [goal()],
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

describe("hasFlag", () => {
	it("returns true for present flag", () => {
		expect(hasFlag(["status", "--json"], "--json")).toBe(true);
	});

	it("returns false otherwise", () => {
		expect(hasFlag(["status"], "--json")).toBe(false);
	});
});

describe("readValue", () => {
	it("returns value after flag", () => {
		expect(readValue(["criteria", "--goal-id", "G001"], "--goal-id")).toBe("G001");
	});

	it("returns undefined when absent", () => {
		expect(readValue(["criteria"], "--goal-id")).toBeUndefined();
	});

	it("returns undefined when flag has no following value", () => {
		expect(readValue(["criteria", "--goal-id"], "--goal-id")).toBeUndefined();
	});
});

describe("readRepeated", () => {
	it("collects all occurrences", () => {
		expect(readRepeated(["create-goals", "--goal", "A", "--goal=B"], "--goal")).toEqual(["A", "B"]);
	});
});

describe("parseGoalArg", () => {
	it("returns value of --goal-id or --goal", () => {
		expect(parseGoalArg(["criteria", "--goal", "G002"])).toBe("G002");
		expect(parseGoalArg(["criteria", "--goal-id", "G001"])).toBe("G001");
	});
});

describe("positionalText", () => {
	it("returns joined positional args after subcommand", () => {
		expect(positionalText(["create-goals", "Build", "auth", "--json", "--brief", "ignored"])).toBe("Build auth");
	});
});

describe("readJsonInput", () => {
	it("parses inline JSON when value looks like JSON", async () => {
		await expect(readJsonInput('{"ok":true}')).resolves.toEqual({ ok: true });
	});

	it("reads from file path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ug-cli-json-"));
		try {
			const file = join(dir, "input.json");
			await writeFile(file, JSON.stringify({ fromFile: true }), "utf8");

			await expect(readJsonInput(file)).resolves.toEqual({ fromFile: true });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("returns undefined when value is undefined", async () => {
		await expect(readJsonInput(undefined)).resolves.toBeUndefined();
	});
});

describe("parseRecordEvidenceArgs", () => {
	it("parses --goal-id + --criterion-id + --status + --evidence", () => {
		expect(
			parseRecordEvidenceArgs([
				"record-evidence",
				"--goal-id",
				"G001",
				"--criterion-id",
				"C001",
				"--status",
				"pass",
				"--evidence",
				"curl 200",
			]),
		).toEqual({ goalId: "G001", criterionId: "C001", status: "pass", evidence: "curl 200" });
	});

	it("throws when goal-id missing", () => {
		expect(() =>
			parseRecordEvidenceArgs(["record-evidence", "--criterion-id", "C001", "--status", "pass", "--evidence", "x"]),
		).toThrow(UlwLoopError);
	});

	it("throws when status is not pass|fail|blocked", () => {
		expect(() =>
			parseRecordEvidenceArgs([
				"record-evidence",
				"--goal-id",
				"G001",
				"--criterion-id",
				"C001",
				"--status",
				"skip",
				"--evidence",
				"x",
			]),
		).toThrow(UlwLoopError);
	});

	it("includes optional --notes when present", () => {
		expect(
			parseRecordEvidenceArgs([
				"record-evidence",
				"--goal-id",
				"G001",
				"--criterion-id",
				"C001",
				"--status",
				"blocked",
				"--evidence",
				"auth missing",
				"--notes",
				"waiting",
			]),
		).toMatchObject({ notes: "waiting" });
	});
});

describe("ULW_LOOP_HELP", () => {
	it("mentions omo ulw-loop + every subcommand", () => {
		expect(ULW_LOOP_HELP).toContain("omo ulw-loop");
		expect(ULW_LOOP_HELP).toContain("create-goals");
		expect(ULW_LOOP_HELP).toContain("complete-goals");
		expect(ULW_LOOP_HELP).toContain("status");
		expect(ULW_LOOP_HELP).toContain("checkpoint");
		expect(ULW_LOOP_HELP).toContain("steer");
		expect(ULW_LOOP_HELP).toContain("record-evidence");
		expect(ULW_LOOP_HELP).toContain("criteria");
		expect(ULW_LOOP_HELP).toContain("add-goal");
		expect(ULW_LOOP_HELP).toContain("record-review-blockers");
	});

	it("never mentions the legacy typo", () => {
		const typo = ["o", "m", "x"].join("");

		expect(ULW_LOOP_HELP).not.toMatch(new RegExp(typo, "i"));
	});
});

describe("printStatus", () => {
	it("shows criteria P/T per goal", () => {
		const output = captureStdout(() => printStatus(plan()));

		expect(output).toContain("criteria: 2/3");
	});

	it("shows aggregate counts", () => {
		const output = captureStdout(() =>
			printStatus(plan({ goals: [goal(), goal({ id: "G002", successCriteria: [criterion({ status: "pass" })] })] })),
		);

		expect(output).toContain("total goals: 2");
		expect(output).toContain("criteria: 3/4 pass");
	});
});

describe("normalizeCodexGoalMode", () => {
	it("returns aggregate when undefined", () => {
		expect(normalizeCodexGoalMode(undefined)).toBe("aggregate");
	});

	it("returns the explicit value when valid", () => {
		expect(normalizeCodexGoalMode("per_story")).toBe("per_story");
	});

	it("throws UlwLoopError when invalid", () => {
		expect(() => normalizeCodexGoalMode("per-story")).toThrow(UlwLoopError);
	});
});
