import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PreToolUsePayload } from "../src/codex-hook.ts";
import { applySpawnGuards } from "../src/spawn-guard.ts";

let workDir: string;
let originalLimit: string | undefined;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "ulw-spawn-guard-"));
	originalLimit = process.env["OMO_SPAWN_FANOUT_LIMIT"];
	delete process.env["OMO_SPAWN_FANOUT_LIMIT"];
});

afterEach(async () => {
	if (originalLimit === undefined) delete process.env["OMO_SPAWN_FANOUT_LIMIT"];
	else process.env["OMO_SPAWN_FANOUT_LIMIT"] = originalLimit;
	await rm(workDir, { recursive: true, force: true });
});

function payload(toolName: string, toolInput: Record<string, unknown>): PreToolUsePayload {
	return {
		hook_event_name: "PreToolUse",
		session_id: "s1",
		turn_id: "t1",
		transcript_path: null,
		cwd: workDir,
		model: "gpt-5.6-sol",
		permission_mode: "default",
		tool_name: toolName,
		tool_use_id: "tu1",
		tool_input: toolInput,
	};
}

function sessionDir(): string {
	return join(workDir, ".omo", "ulw-loop", "s1");
}

function criterion(id: string): Record<string, unknown> {
	return {
		id,
		scenario: `scenario ${id}`,
		userModel: "happy",
		expectedEvidence: "evidence",
		capturedEvidence: "captured",
		status: "pass",
		capturedAt: "2026-07-11T00:00:00.000Z",
	};
}

function writeGoals(planOverrides: Record<string, unknown> = {}): void {
	mkdirSync(sessionDir(), { recursive: true });
	writeFileSync(
		join(sessionDir(), "goals.json"),
		JSON.stringify({
			version: 1,
			createdAt: "2026-07-11T00:00:00.000Z",
			updatedAt: "2026-07-11T00:00:00.000Z",
			briefPath: ".omo/ulw-loop/s1/brief.md",
			goalsPath: ".omo/ulw-loop/s1/goals.json",
			ledgerPath: ".omo/ulw-loop/s1/ledger.jsonl",
			codexGoalMode: "aggregate",
			goals: [
				{
					id: "g1",
					title: "Final goal",
					objective: "Final goal",
					status: "in_progress",
					successCriteria: [criterion("C001"), criterion("C002")],
					attempt: 1,
					createdAt: "2026-07-11T00:00:00.000Z",
					updatedAt: "2026-07-11T00:00:00.000Z",
				},
			],
			activeGoalId: "g1",
			...planOverrides,
		}),
	);
}

function deny(output: string): { permissionDecision: string; permissionDecisionReason: string } {
	return JSON.parse(output).hookSpecificOutput;
}

describe("applySpawnGuards fan-out cap", () => {
	it("#given spawns under the limit #when guarded #then allows and counts", () => {
		writeGoals();

		expect(applySpawnGuards(payload("spawn_agent", { message: "scan" }))).toBe("");

		const counter = JSON.parse(readFileSync(join(sessionDir(), "spawn-count.json"), "utf8"));
		expect(counter.count).toBe(1);
	});

	it("#given the env limit exceeded #when guarded #then denies naming count/limit", () => {
		writeGoals();
		process.env["OMO_SPAWN_FANOUT_LIMIT"] = "3";

		expect(applySpawnGuards(payload("spawn_agent", { message: "scan" }))).toBe("");
		expect(applySpawnGuards(payload("spawn_agent", { message: "scan" }))).toBe("");
		expect(applySpawnGuards(payload("spawn_agent", { message: "scan" }))).toBe("");
		const fourth = applySpawnGuards(payload("spawn_agent", { message: "scan" }));

		const output = deny(fourth);
		expect(output.permissionDecision).toBe("deny");
		expect(output.permissionDecisionReason).toContain("4/3");
	});

	it("#given no ulw-loop session state #when guarded #then no-ops without counting", () => {
		expect(applySpawnGuards(payload("spawn_agent", { message: "scan" }))).toBe("");
	});

	it("#given a non-spawn tool #when guarded #then no-ops", () => {
		writeGoals();

		expect(applySpawnGuards(payload("create_goal", { objective: "x" }))).toBe("");
	});

	it("#given the observed dotted v2 token #when guarded #then it counts too", () => {
		writeGoals();
		process.env["OMO_SPAWN_FANOUT_LIMIT"] = "1";

		expect(applySpawnGuards(payload("collaboration.spawn_agent", { message: "scan" }))).toBe("");
		const second = applySpawnGuards(payload("collaborationspawn_agent", { message: "scan" }));

		expect(deny(second).permissionDecisionReason).toContain("2/1");
	});
});

describe("applySpawnGuards gate-artifact guard", () => {
	it("#given a gate spawn by agent_type without artifacts #when guarded #then denies naming the missing path", () => {
		writeGoals();

		const output = applySpawnGuards(
			payload("collaborationspawn_agent", { agent_type: "lazycodex-gate-reviewer", message: "final gate review" }),
		);

		const parsed = deny(output);
		expect(parsed.permissionDecision).toBe("deny");
		expect(parsed.permissionDecisionReason).toContain("missing");
		expect(parsed.permissionDecisionReason).toContain("g1-code-review.md");
	});

	it("#given a gate spawn identified by message only #when guarded #then still denies", () => {
		writeGoals();

		const output = applySpawnGuards(payload("spawn_agent", { message: "run the FINAL GATE REVIEW now" }));

		expect(deny(output).permissionDecision).toBe("deny");
	});

	it("#given v1 artifacts on disk #when the gate spawns #then allows", () => {
		writeGoals();
		mkdirSync(join(workDir, ".omo", "evidence"), { recursive: true });
		writeFileSync(join(workDir, ".omo", "evidence", "g1-code-review.md"), "report\n");
		writeFileSync(join(workDir, ".omo", "evidence", "g1-manual-qa.md"), "matrix\n");

		const output = applySpawnGuards(
			payload("spawn_agent", { agent_type: "lazycodex-gate-reviewer", message: "final gate review" }),
		);

		expect(output).toBe("");
	});

	it("#given a v2 plan #when the gate spawns without attempt-dir artifacts #then denies naming the attempt path", () => {
		writeGoals({ evidenceLayoutVersion: 2 });
		mkdirSync(join(workDir, ".omo", "evidence"), { recursive: true });
		writeFileSync(join(workDir, ".omo", "evidence", "g1-code-review.md"), "stale flat report\n");

		const output = applySpawnGuards(
			payload("spawn_agent", { agent_type: "lazycodex-gate-reviewer", message: "final gate review" }),
		);

		expect(deny(output).permissionDecisionReason).toContain(".omo/evidence/ulw/s1/g1/a1/g1-code-review.md");
	});

	it("#given a v2 plan with attempt-dir artifacts #when the gate spawns #then allows", () => {
		writeGoals({ evidenceLayoutVersion: 2 });
		const attemptDir = join(workDir, ".omo", "evidence", "ulw", "s1", "g1", "a1");
		mkdirSync(attemptDir, { recursive: true });
		writeFileSync(join(attemptDir, "g1-code-review.md"), "report\n");
		writeFileSync(join(attemptDir, "g1-manual-qa.md"), "matrix\n");

		const output = applySpawnGuards(
			payload("spawn_agent", { agent_type: "lazycodex-gate-reviewer", message: "final gate review" }),
		);

		expect(output).toBe("");
	});

	it("#given the final goal's criteria are not all pass #when the gate spawns #then no-ops", () => {
		writeGoals({
			goals: [
				{
					id: "g1",
					title: "Final goal",
					objective: "Final goal",
					status: "in_progress",
					successCriteria: [criterion("C001"), { ...criterion("C002"), status: "pending" }],
					attempt: 1,
					createdAt: "2026-07-11T00:00:00.000Z",
					updatedAt: "2026-07-11T00:00:00.000Z",
				},
			],
		});

		const output = applySpawnGuards(
			payload("spawn_agent", { agent_type: "lazycodex-gate-reviewer", message: "final gate review" }),
		);

		expect(output).toBe("");
	});

	it("#given a non-gate reviewer spawn #when artifacts are missing #then never denies on the artifact rule", () => {
		writeGoals();

		const output = applySpawnGuards(
			payload("spawn_agent", { agent_type: "lazycodex-code-reviewer", message: "review the diff" }),
		);

		expect(output).toBe("");
	});
});
