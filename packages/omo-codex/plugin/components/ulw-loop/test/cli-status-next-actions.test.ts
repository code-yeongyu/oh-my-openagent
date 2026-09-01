import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.js";
import { ulwLoopDir } from "../src/paths.js";
import { writePlan } from "../src/plan-io.js";
import type { UlwLoopItem, UlwLoopPlan, UlwLoopSuccessCriterion } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";
const SESSION_ENV_KEYS = ["OMO_ULW_LOOP_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID", "PI_SESSION_ID"] as const;

let testDir: string;
let out: string[];
let err: string[];
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-status-next-"));
	out = [];
	err = [];
	savedEnv = {};
	for (const key of SESSION_ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
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
	for (const key of SESSION_ENV_KEYS) {
		const saved = savedEnv[key];
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
	await rm(testDir, { recursive: true, force: true });
});

function stdoutJson(): Record<string, unknown> {
	return JSON.parse(out.join(""));
}

function nextActions(): readonly string[] {
	const value = stdoutJson()["nextActions"];
	if (!Array.isArray(value)) throw new Error(`expected nextActions array, got ${JSON.stringify(value)}`);
	return value.map((entry) => String(entry));
}

function criterion(id: string, status: UlwLoopSuccessCriterion["status"]): UlwLoopSuccessCriterion {
	return {
		id,
		scenario: `${id} scenario`,
		userModel: "happy",
		expectedEvidence: `${id} proof`,
		capturedEvidence: status === "pass" ? `${id} passed` : null,
		status,
	};
}

function goal(overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return {
		id: "G001",
		title: "Build auth",
		objective: "Implement JWT auth endpoint",
		status: "in_progress",
		successCriteria: [criterion("C001", "pass")],
		attempt: 1,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function plan(goals: UlwLoopItem[], overrides: Partial<UlwLoopPlan> = {}): UlwLoopPlan {
	const result: UlwLoopPlan = {
		version: 1,
		evidenceLayoutVersion: 2,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		goals,
	};
	Object.assign(result, overrides);
	return result;
}

function legacyLayoutPlan(goals: UlwLoopItem[], overrides: Partial<UlwLoopPlan> = {}): UlwLoopPlan {
	const result = plan(goals, overrides);
	delete result.evidenceLayoutVersion;
	return result;
}

async function seed(seedPlan: UlwLoopPlan): Promise<void> {
	await mkdir(ulwLoopDir(testDir), { recursive: true });
	await writePlan(testDir, seedPlan);
}

describe("#given a plan with no goals", () => {
	it("#when status --json #then nextActions points at create-goals", async () => {
		await seed(plan([]));

		expect(await ulwLoopCommand(["status", "--json"])).toBe(0);
		expect(nextActions().join("\n")).toContain('omo-agent-toolkit ulw-loop create-goals --brief "<brief>" --json');
	});
});

describe("#given an active goal with unresolved criteria", () => {
	it("#when status --json #then nextActions names record-evidence with the remaining criterion ids", async () => {
		await seed(
			plan(
				[
					goal({
						successCriteria: [criterion("C001", "pass"), criterion("C002", "pending"), criterion("C003", "fail")],
					}),
				],
				{
					activeGoalId: "G001",
				},
			),
		);

		expect(await ulwLoopCommand(["status", "--json"])).toBe(0);
		const actions = nextActions().join("\n");
		expect(actions).toContain("record-evidence");
		expect(actions).toContain("C002");
		expect(actions).toContain("C003");
		expect(actions).not.toContain("C001");
		expect(stdoutJson()).toHaveProperty("currentAttemptDir");
	});
});

describe("#given the final story with every criterion passing", () => {
	it("#when status --json #then nextActions tells the agent to complete the goal then print the template", async () => {
		await seed(plan([goal({ successCriteria: [criterion("C001", "pass")] })], { activeGoalId: "G001" }));

		expect(await ulwLoopCommand(["status", "--json"])).toBe(0);
		const actions = nextActions().join("\n");
		expect(actions).toContain("update_goal complete, then checkpoint --print-template");
	});
});

describe("#given a review_blocked goal", () => {
	it("#when status --json #then nextActions points at record-review-blockers", async () => {
		await seed(plan([goal({ status: "review_blocked", successCriteria: [criterion("C001", "pass")] })]));

		expect(await ulwLoopCommand(["status", "--json"])).toBe(0);
		expect(nextActions().join("\n")).toContain("record-review-blockers");
	});
});

describe("#given an evidence-layout v1 plan", () => {
	it("#when status --json #then currentAttemptDir stays absent and nextActions explains the v1 layout", async () => {
		await seed(legacyLayoutPlan([goal()], { activeGoalId: "G001" }));

		expect(await ulwLoopCommand(["status", "--json"])).toBe(0);
		expect(stdoutJson()).not.toHaveProperty("currentAttemptDir");
		expect(nextActions().join("\n")).toContain("plan is evidence-layout v1; artifacts go under .omo/evidence/");
	});
});

describe("#given a valueless --session-id in a subprocess context", () => {
	it("#when any subcommand runs #then the error explains the missing session env and the flag usage", async () => {
		expect(await ulwLoopCommand(["status", "--session-id", "--json"])).toBe(1);

		const payload = stdoutJson();
		expect(payload).toMatchObject({ ok: false, error: { code: "ULW_LOOP_SESSION_ID_REQUIRED" } });
		const message = String((payload["error"] as Record<string, unknown>)["message"]);
		expect(message).toContain("--session-id <id>");
		expect(message).toContain("subprocess");
	});
});
