import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulwLoopDir } from "../src/paths.js";
import { writePlan } from "../src/plan-io.js";
import {
	type CheckpointArgs,
	type CreateGoalsArgs,
	createAgentToolkit,
	type RecordEvidenceArgs,
	type RecordReviewBlockersArgs,
	type ToolkitSurface,
} from "../src/sdk.js";
import type { UlwLoopPlan } from "../src/types.js";
import { criterion, goal, plan } from "./fixtures/checkpoint-builders.js";

const scope = { sessionId: "surface-test" };
const surfaces: ToolkitSurface[] = ["omo-senpi", "lazycodex"];
let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "ulw-surface-"));
});
afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

interface Scenario {
	readonly name: string;
	readonly plan: UlwLoopPlan;
	readonly method: string;
	readonly args:
		| CreateGoalsArgs
		| RecordEvidenceArgs
		| CheckpointArgs
		| Omit<RecordReviewBlockersArgs, "codexGoalJson">;
	readonly cli: string;
}

const scenarios: Scenario[] = [
	{
		name: "no goals",
		plan: plan([]),
		method: "createGoals",
		args: { brief: "<brief>" },
		cli: 'omo-agent-toolkit ulw-loop create-goals --brief "<brief>" --json',
	},
	{
		name: "unresolved criteria",
		plan: plan([goal({ successCriteria: [criterion("C001", "pass"), criterion("C002", "pending")] })]),
		method: "recordEvidence",
		args: { goalId: "G001", criterionId: "<id>", status: "pass", evidence: "<observable proof>" },
		cli: 'omo-agent-toolkit ulw-loop record-evidence --goal-id G001 --criterion-id <id> --status pass --evidence "<observable proof>"',
	},
	{
		name: "a passing non-final goal",
		plan: plan([goal(), goal({ id: "G002", status: "pending" })]),
		method: "checkpoint",
		args: { goalId: "G001", status: "complete", evidence: "<proof>" },
		cli: "omo-agent-toolkit ulw-loop checkpoint --goal-id G001 --status complete --evidence \"<proof>\" --codex-goal-json '<get_goal json>'",
	},
	{
		name: "a passing final goal",
		plan: plan([goal()]),
		method: "checkpoint",
		args: { goalId: "G001", printTemplate: true },
		cli: "checkpoint --print-template",
	},
	{
		name: "a review-blocked goal",
		plan: plan([goal({ status: "review_blocked" })]),
		method: "recordReviewBlockers",
		args: { goalId: "G001", title: "<title>", objective: "<objective>", evidence: "<verdict>" },
		cli: 'omo-agent-toolkit ulw-loop record-review-blockers --goal-id G001 --title "<title>" --objective "<objective>" --evidence "<verdict>" --codex-goal-json \'<get_goal json>\'',
	},
];

function sdkArgs(text: string, method: string): unknown {
	const snippet = text.match(new RegExp(`agentToolkit\\.${method}\\([^\x60]*\\)`))?.[0];
	expect(snippet).toBeDefined();
	if (snippet === undefined) throw new Error(`Missing SDK call: ${method}`);
	return runInNewContext(snippet, { agentToolkit: { [method]: (args: unknown) => args } });
}

for (const surface of surfaces) {
	describe(`#given the ${surface} SDK surface`, () => {
		it.each(scenarios)("#when status reads $name #then its action uses the calling surface", async (scenario) => {
			await mkdir(ulwLoopDir(cwd, scope), { recursive: true });
			await writePlan(cwd, { ...scenario.plan, evidenceLayoutVersion: 2 }, scope);
			const response = await createAgentToolkit({ cwd, ...scope, surface }).status();
			if (!response.ok) throw new Error(response.error.message);

			expect(response.nextActions).toEqual(response.result.nextActions);
			const actions = response.nextActions.join("\n");
			if (surface === "lazycodex") {
				expect(actions).toContain(scenario.cli);
				expect(actions).not.toContain("agentToolkit.");
				return;
			}
			expect(actions).not.toMatch(/omo-agent-toolkit|status --json|codexGoalJson|--codex-goal-json|update_goal/);
			expect(sdkArgs(actions, scenario.method)).toEqual(scenario.args);
			if (scenario.method === "checkpoint") expect(actions).toContain("status().result.currentAttemptDir");
		});

		for (const siblings of [false, true]) {
			it.each(["status", "completeGoals"])(
				`#when %s has no plan and siblings=${siblings} #then recovery uses the calling surface`,
				async (method) => {
					if (siblings) await mkdir(ulwLoopDir(cwd, { sessionId: "other-session" }), { recursive: true });
					const toolkit = createAgentToolkit({ cwd, ...scope, surface });
					const response = await (method === "status" ? toolkit.status() : toolkit.completeGoals());
					if (response.ok) throw new Error("Expected a missing-plan failure");

					expect(response.error.code).toBe("ULW_LOOP_PLAN_MISSING");
					if (surface === "lazycodex") {
						expect(response.error.message).toContain(
							'omo-agent-toolkit ulw-loop create-goals --brief "<brief>" --json',
						);
						if (siblings) expect(response.error.message).toContain("--session-id <id>");
					} else {
						expect(response.error.message).not.toMatch(/omo-agent-toolkit|--session-id/);
						expect(sdkArgs(response.error.message, "createGoals")).toEqual({ brief: "<brief>" });
					}
					if (siblings)
						expect(response.error.details?.["existingSessionIds"]?.split(",")).toContain("other-session");
				},
			);
		}
	});
}
