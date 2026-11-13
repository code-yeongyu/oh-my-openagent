import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PreToolUsePayload } from "../src/codex-hook.ts";
import { applySpawnBudgetGuards as applySpawnGuards } from "../src/spawn-guard.ts";

// The agent resolver canonicalizes omo-senpi-* to omo-native-* BEFORE this guard sees a name, so
// the guard receives the canonical spelling. When it does not recognize that spelling
// `reviewAgentType` returns null, which makes the gate-artifact check and the reviewer quota both
// stop applying without any error.

let workDir: string;
let originalReviewLimit: string | undefined;
let originalToolkitSurface: string | undefined;
let originalPluginData: string | undefined;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "ulw-native-reviewer-"));
	originalPluginData = process.env["PLUGIN_DATA"];
	process.env["PLUGIN_DATA"] = join(workDir, "plugin-data");
	originalReviewLimit = process.env["OMO_ULW_LOOP_REVIEW_SPAWN_LIMIT"];
	originalToolkitSurface = process.env["OMO_AGENT_TOOLKIT_SURFACE"];
	delete process.env["OMO_ULW_LOOP_REVIEW_SPAWN_LIMIT"];
	delete process.env["OMO_AGENT_TOOLKIT_SURFACE"];
});

afterEach(async () => {
	if (originalToolkitSurface === undefined) delete process.env["OMO_AGENT_TOOLKIT_SURFACE"];
	else process.env["OMO_AGENT_TOOLKIT_SURFACE"] = originalToolkitSurface;
	if (originalReviewLimit === undefined) delete process.env["OMO_ULW_LOOP_REVIEW_SPAWN_LIMIT"];
	else process.env["OMO_ULW_LOOP_REVIEW_SPAWN_LIMIT"] = originalReviewLimit;
	if (originalPluginData === undefined) delete process.env["PLUGIN_DATA"];
	else process.env["PLUGIN_DATA"] = originalPluginData;
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

function writeGoals(): void {
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
		}),
	);
}

function writeEvidence(name: string, body: string): void {
	mkdirSync(join(workDir, ".omo", "evidence"), { recursive: true });
	writeFileSync(join(workDir, ".omo", "evidence", name), body);
}

function denial(output: string): { permissionDecision: string; permissionDecisionReason: string } {
	return JSON.parse(output).hookSpecificOutput;
}

describe("applySpawnGuards recognizes the canonical omo-native reviewer names", () => {
	// Unmodified code returns "" for BOTH of the next two cases, so only the denial can fail. The
	// allow case is its control: without it, a blanket denial would also pass.
	it("#given senpi manual QA is absent #when the canonical gate reviewer spawns #then it is denied naming manual QA", () => {
		// given
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		writeGoals();

		// when
		const output = applySpawnGuards(
			payload("collaborationspawn_agent", {
				agent_type: "omo-native-gate-reviewer",
				message: "audit the artifacts",
			}),
		);

		// then
		expect(output, "an empty guard result means the spawn was allowed").not.toBe("");
		const parsed = denial(output);
		expect(parsed.permissionDecision).toBe("deny");
		expect(parsed.permissionDecisionReason).toContain("g1-manual-qa.md");
	});

	it("#given senpi manual QA is present #when the canonical gate reviewer spawns #then it is allowed", () => {
		// given
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		writeGoals();
		writeEvidence("g1-manual-qa.md", "matrix\n");

		// when
		const output = applySpawnGuards(
			payload("collaborationspawn_agent", {
				agent_type: "omo-native-gate-reviewer",
				message: "audit the artifacts",
			}),
		);

		// then
		expect(output).toBe("");
	});

	it("#given a message-only spawn naming the canonical gate reviewer #when guarded #then it is still recognized", () => {
		// given
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		writeGoals();

		// when
		const output = applySpawnGuards(
			payload("spawn_agent", { message: "Act as omo-native-gate-reviewer; audit the final evidence" }),
		);

		// then
		expect(output, "an empty guard result means the spawn was allowed").not.toBe("");
		expect(denial(output).permissionDecision).toBe("deny");
	});

	it("#given repeated canonical gate spawns #when the reviewer cap is exceeded #then the fourth is denied", () => {
		// given
		writeGoals();
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		writeEvidence("g1-code-review.md", "report\n");
		writeEvidence("g1-manual-qa.md", "matrix\n");
		const canonicalGate = payload("spawn_agent", {
			agent_type: "omo-native-gate-reviewer",
			message: "audit the final evidence",
		});

		// when
		expect(applySpawnGuards(canonicalGate)).toBe("");
		expect(applySpawnGuards(canonicalGate)).toBe("");
		expect(applySpawnGuards(canonicalGate)).toBe("");
		const fourthOutput = applySpawnGuards(canonicalGate);

		// then
		expect(fourthOutput, "an empty fourth result means the reviewer cap never counted").not.toBe("");
		const fourth = denial(fourthOutput);
		expect(fourth.permissionDecision).toBe("deny");
		expect(fourth.permissionDecisionReason).toContain("4/3");
		const counters = JSON.parse(readFileSync(join(sessionDir(), "review-spawn-counts.json"), "utf8"));
		expect(counters["omo-native-gate-reviewer:g1:a1"]).toBe(3);
	});

	it("#given the legacy spelling #when the gate reviewer spawns without manual QA #then it is denied exactly as before", () => {
		// given
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		writeGoals();

		// when
		const output = applySpawnGuards(
			payload("collaborationspawn_agent", {
				agent_type: "omo-senpi-gate-reviewer",
				message: "audit the artifacts",
			}),
		);

		// then
		expect(denial(output).permissionDecisionReason).toContain("g1-manual-qa.md");
	});
});
