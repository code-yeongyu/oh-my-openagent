import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PreToolUsePayload } from "../src/codex-hook.ts";
import { applySpawnGuards } from "../src/spawn-guard.ts";

let workDir: string;
let originalLimit: string | undefined;
let originalReviewLimit: string | undefined;
let originalToolkitSurface: string | undefined;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "ulw-spawn-guard-"));
	originalLimit = process.env["OMO_SPAWN_FANOUT_LIMIT"];
	originalReviewLimit = process.env["OMO_ULW_LOOP_REVIEW_SPAWN_LIMIT"];
	originalToolkitSurface = process.env["OMO_AGENT_TOOLKIT_SURFACE"];
	delete process.env["OMO_SPAWN_FANOUT_LIMIT"];
	delete process.env["OMO_ULW_LOOP_REVIEW_SPAWN_LIMIT"];
	delete process.env["OMO_AGENT_TOOLKIT_SURFACE"];
});

afterEach(async () => {
	delete process.env["OMO_AGENT_TOOLKIT_SURFACE"];
	if (originalLimit === undefined) delete process.env["OMO_SPAWN_FANOUT_LIMIT"];
	else process.env["OMO_SPAWN_FANOUT_LIMIT"] = originalLimit;
	if (originalReviewLimit === undefined) delete process.env["OMO_ULW_LOOP_REVIEW_SPAWN_LIMIT"];
	else process.env["OMO_ULW_LOOP_REVIEW_SPAWN_LIMIT"] = originalReviewLimit;
	if (originalToolkitSurface === undefined) delete process.env["OMO_AGENT_TOOLKIT_SURFACE"];
	else process.env["OMO_AGENT_TOOLKIT_SURFACE"] = originalToolkitSurface;
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

describe("applySpawnGuards fan-out cap + reviewer quota interaction", () => {
	it("#given fan-out cap exhausted #when a reviewer spawns #then denies without charging reviewer quota", () => {
		writeGoals();
		process.env["OMO_SPAWN_FANOUT_LIMIT"] = "3";

		// exhaust the fan-out cap with non-reviewer spawns
		expect(applySpawnGuards(payload("spawn_agent", { message: "scan" }))).toBe("");
		expect(applySpawnGuards(payload("spawn_agent", { message: "scan" }))).toBe("");
		expect(applySpawnGuards(payload("spawn_agent", { message: "scan" }))).toBe("");

		// reviewer spawn while cap is exhausted — must deny without incrementing reviewer count
		const reviewSpawn = payload("spawn_agent", {
			agent_type: "lazycodex-code-reviewer",
			message: "review the current diff",
		});
		const result = applySpawnGuards(reviewSpawn);
		expect(result).not.toBe("");
		expect(deny(result).permissionDecisionReason).toContain("4/3");

		// reviewer quota must be untouched — a subsequent spawn after raising the limit must succeed
		process.env["OMO_SPAWN_FANOUT_LIMIT"] = "10";
		expect(applySpawnGuards(reviewSpawn)).toBe("");
		const counters = JSON.parse(readFileSync(join(sessionDir(), "review-spawn-counts.json"), "utf8"));
		expect(counters["lazycodex-code-reviewer:g1:a1"]).toBe(1);
	});
});

describe("applySpawnGuards review repetition cap", () => {
	it("#given one goal attempt #when the same reviewer spawns four times #then denies until the attempt advances", () => {
		writeGoals();
		const reviewSpawn = payload("spawn_agent", {
			agent_type: "lazycodex-code-reviewer",
			message: "review the current diff",
		});

		expect(applySpawnGuards(reviewSpawn)).toBe("");
		expect(applySpawnGuards(reviewSpawn)).toBe("");
		expect(applySpawnGuards(reviewSpawn)).toBe("");

		const fourth = applySpawnGuards(reviewSpawn);
		expect(fourth).not.toBe("");
		expect(deny(fourth).permissionDecisionReason).toContain("4/3");
		const counter = JSON.parse(readFileSync(join(sessionDir(), "spawn-count.json"), "utf8"));
		expect(counter.count).toBe(3);

		const goalsPath = join(sessionDir(), "goals.json");
		const plan = JSON.parse(readFileSync(goalsPath, "utf8")) as {
			goals: Array<{ attempt: number }>;
		};
		const [goal] = plan.goals;
		if (goal === undefined) throw new Error("fixture must include a goal");
		goal.attempt = 2;
		writeFileSync(goalsPath, JSON.stringify(plan));

		expect(applySpawnGuards(reviewSpawn)).toBe("");
	});

	it.each(["lazycodex-code-reviewer", "lazycodex-qa-executor"])(
		"#given a MultiAgentV2 %s message #when it spawns four times #then applies the reviewer cap",
		(agentType) => {
			writeGoals();
			const reviewSpawn = payload("spawn_agent", {
				message: `Delegate this final-quality lane to ${agentType}`,
			});

			expect(applySpawnGuards(reviewSpawn)).toBe("");
			expect(applySpawnGuards(reviewSpawn)).toBe("");
			expect(applySpawnGuards(reviewSpawn)).toBe("");

			const fourth = deny(applySpawnGuards(reviewSpawn));
			expect(fourth.permissionDecisionReason).toContain(`${agentType} 4/3`);
		},
	);

	it("#given exhausted code reviews and an explicit QA assignment #when a mixed V2 prompt is guarded #then charges the QA role", () => {
		writeGoals();
		const codeReview = payload("collaboration.spawn_agent", {
			message: "Act as lazycodex-code-reviewer; review the current diff",
		});

		expect(applySpawnGuards(codeReview)).toBe("");
		expect(applySpawnGuards(codeReview)).toBe("");
		expect(applySpawnGuards(codeReview)).toBe("");

		const output = applySpawnGuards(
			payload("collaboration.spawn_agent", {
				message: "Act as a lazycodex-qa-executor; verify the lazycodex-code-reviewer finding",
			}),
		);
		expect(output).toBe("");

		const counters = JSON.parse(readFileSync(join(sessionDir(), "review-spawn-counts.json"), "utf8"));
		expect(counters["lazycodex-code-reviewer:g1:a1"]).toBe(3);
		expect(counters["lazycodex-qa-executor:g1:a1"]).toBe(1);
	});
});

describe("applySpawnGuards gate-artifact guard", () => {
	it("#given a mixed-role V2 gate prompt #when guarded #then prioritizes the gate role and denies on missing artifact without charging quota", () => {
		writeGoals();

		const output = applySpawnGuards(
			payload("spawn_agent", {
				message: "Act as lazycodex-gate-reviewer; audit the lazycodex-code-reviewer report",
			}),
		);

		expect(output).not.toBe("");
		expect(deny(output).permissionDecisionReason).toContain("g1-code-review.md");
		expect(existsSync(join(sessionDir(), "review-spawn-counts.json"))).toBe(false);
	});

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

	it("#given senpi main-session QA is present but code review is absent #when the gate reviewer spawns #then the self-check allows it", () => {
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		writeGoals();
		mkdirSync(join(workDir, ".omo", "evidence"), { recursive: true });
		writeFileSync(join(workDir, ".omo", "evidence", "g1-manual-qa.md"), "matrix\n");

		const output = applySpawnGuards(
			payload("collaborationspawn_agent", { agent_type: "omo-senpi-gate-reviewer", message: "audit the artifacts" }),
		);

		expect(output).toBe("");
	});

	it("#given senpi QA is absent #when the gate reviewer spawns #then the self-check blocks naming manual QA", () => {
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		writeGoals();

		const output = applySpawnGuards(
			payload("collaborationspawn_agent", { agent_type: "omo-senpi-gate-reviewer", message: "audit the artifacts" }),
		);

		const parsed = deny(output);
		expect(parsed.permissionDecision).toBe("deny");
		expect(parsed.permissionDecisionReason).toContain("g1-manual-qa.md");
	});

	it("#given an omo-senpi gate spawn with a code-review artifact only #when guarded #then blocks the missing manual QA", () => {
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		writeGoals();
		mkdirSync(join(workDir, ".omo", "evidence"), { recursive: true });
		writeFileSync(join(workDir, ".omo", "evidence", "g1-code-review.md"), "report\n");

		const output = applySpawnGuards(
			payload("collaborationspawn_agent", { agent_type: "omo-senpi-gate-reviewer", message: "audit the artifacts" }),
		);

		expect(deny(output).permissionDecisionReason).toContain("g1-manual-qa.md");
	});

	it("#given an omo-senpi gate reviewer named in the message #when guarded #then still denies", () => {
		writeGoals();

		const output = applySpawnGuards(payload("spawn_agent", { message: "spawn omo-senpi-gate-reviewer now" }));

		expect(deny(output).permissionDecision).toBe("deny");
	});

	it("#given a gate spawn identified by message only #when guarded #then still denies", () => {
		writeGoals();

		const output = applySpawnGuards(payload("spawn_agent", { message: "run the FINAL GATE REVIEW now" }));

		expect(deny(output).permissionDecision).toBe("deny");
	});

	it("#given the staged Senpi surface #when generic and explicit gate spawns alternate #then they share one cap", () => {
		writeGoals();
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		mkdirSync(join(workDir, ".omo", "evidence"), { recursive: true });
		writeFileSync(join(workDir, ".omo", "evidence", "g1-code-review.md"), "report\n");
		writeFileSync(join(workDir, ".omo", "evidence", "g1-manual-qa.md"), "matrix\n");
		const genericGate = payload("spawn_agent", { message: "run the final gate review now" });
		const explicitGate = payload("spawn_agent", {
			message: "Act as omo-senpi-gate-reviewer; audit the final evidence",
		});

		expect(applySpawnGuards(genericGate)).toBe("");
		expect(applySpawnGuards(explicitGate)).toBe("");
		expect(applySpawnGuards(genericGate)).toBe("");

		const fourth = deny(applySpawnGuards(explicitGate));
		expect(fourth.permissionDecisionReason).toContain("omo-senpi-gate-reviewer 4/3");
		const counters = JSON.parse(readFileSync(join(sessionDir(), "review-spawn-counts.json"), "utf8"));
		expect(counters["omo-senpi-gate-reviewer:g1:a1"]).toBe(3);
		expect(counters["lazycodex-gate-reviewer:g1:a1"]).toBeUndefined();
	});

	it("#given the staged Senpi surface #when LazyCodex and Senpi aliases alternate #then one reviewer lane owns the cap", () => {
		writeGoals();
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		const senpiReviewer = payload("spawn_agent", {
			message: "Act as omo-senpi-code-reviewer; inspect the current diff",
		});
		const lazycodexReviewer = payload("spawn_agent", {
			message: "Act as lazycodex-code-reviewer; inspect the current diff",
		});

		expect(applySpawnGuards(senpiReviewer)).toBe("");
		expect(applySpawnGuards(lazycodexReviewer)).toBe("");
		expect(applySpawnGuards(senpiReviewer)).toBe("");

		const fourth = deny(applySpawnGuards(lazycodexReviewer));
		expect(fourth.permissionDecisionReason).toContain("omo-senpi-code-reviewer 4/3");
		const counters = JSON.parse(readFileSync(join(sessionDir(), "review-spawn-counts.json"), "utf8"));
		expect(counters["omo-senpi-code-reviewer:g1:a1"]).toBe(3);
		expect(counters["lazycodex-code-reviewer:g1:a1"]).toBeUndefined();
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

describe("applySpawnGuards V1 agent_type non-reviewer early-exit", () => {
	it("#given a V1 spawn with a non-reviewer agent_type #when guarded #then allows without charging any quota", () => {
		writeGoals();
		const explorerSpawn = payload("spawn_agent", {
			agent_type: "explorer",
			message: "scan the codebase for lazycodex-code-reviewer patterns",
		});

		const result = applySpawnGuards(explorerSpawn);

		expect(result).toBe("");
		expect(existsSync(join(sessionDir(), "review-spawn-counts.json"))).toBe(false);
	});

	it("#given a V1 spawn with a non-reviewer agent_type mentioning a gate role #when guarded #then does not charge gate quota", () => {
		writeGoals();
		const explorerSpawn = payload("spawn_agent", {
			agent_type: "deep",
			message: "final gate review — summarize findings",
		});

		const result = applySpawnGuards(explorerSpawn);

		expect(result).toBe("");
		expect(existsSync(join(sessionDir(), "review-spawn-counts.json"))).toBe(false);
	});
});

describe("applySpawnGuards V2 explicit non-reviewer act-as guard", () => {
	it("#given an explicit 'act as explorer' assignment mentioning a reviewer #when guarded #then allows without charging reviewer quota", () => {
		writeGoals();
		const explorerSpawn = payload("spawn_agent", {
			message: "Act as explorer; scan for lazycodex-code-reviewer usage patterns",
		});

		const result = applySpawnGuards(explorerSpawn);

		expect(result).toBe("");
		expect(existsSync(join(sessionDir(), "review-spawn-counts.json"))).toBe(false);
	});

	it("#given an explicit 'act as a deep' assignment with gate keyword #when guarded #then allows without charging gate quota", () => {
		writeGoals();
		const deepSpawn = payload("spawn_agent", {
			message: "Act as a deep agent; run the final gate review summary",
		});

		const result = applySpawnGuards(deepSpawn);

		expect(result).toBe("");
		expect(existsSync(join(sessionDir(), "review-spawn-counts.json"))).toBe(false);
	});

	it("#given an explicit reviewer act-as assignment #when guarded #then still charges reviewer quota", () => {
		writeGoals();
		const reviewerSpawn = payload("spawn_agent", {
			message: "Act as lazycodex-code-reviewer; inspect the diff",
		});

		const result = applySpawnGuards(reviewerSpawn);

		expect(result).toBe("");
		const counters = JSON.parse(readFileSync(join(sessionDir(), "review-spawn-counts.json"), "utf8"));
		expect(counters["lazycodex-code-reviewer:g1:a1"]).toBe(1);
	});
});

describe("applySpawnGuards gate-artifact check before reviewer quota", () => {
	it("#given a gate spawn without artifacts #when the fan-out budget is available #then denies on artifact rule without charging reviewer quota", () => {
		writeGoals();

		const gateSpawn = payload("spawn_agent", {
			agent_type: "lazycodex-gate-reviewer",
			message: "final gate review",
		});

		const result = applySpawnGuards(gateSpawn);

		expect(result).not.toBe("");
		expect(deny(result).permissionDecisionReason).toContain("missing");
		expect(existsSync(join(sessionDir(), "review-spawn-counts.json"))).toBe(false);
	});

	it("#given a gate spawn denied for missing artifacts #when retried after artifacts land #then charges quota only on the allowed spawn", () => {
		writeGoals();
		const gateSpawn = payload("spawn_agent", {
			agent_type: "lazycodex-gate-reviewer",
			message: "final gate review",
		});

		const firstResult = applySpawnGuards(gateSpawn);
		expect(firstResult).not.toBe("");
		expect(existsSync(join(sessionDir(), "review-spawn-counts.json"))).toBe(false);

		mkdirSync(join(workDir, ".omo", "evidence"), { recursive: true });
		writeFileSync(join(workDir, ".omo", "evidence", "g1-code-review.md"), "report\n");
		writeFileSync(join(workDir, ".omo", "evidence", "g1-manual-qa.md"), "matrix\n");

		const secondResult = applySpawnGuards(gateSpawn);
		expect(secondResult).toBe("");
		const counters = JSON.parse(readFileSync(join(sessionDir(), "review-spawn-counts.json"), "utf8"));
		expect(counters["lazycodex-gate-reviewer:g1:a1"]).toBe(1);
	});
});
