import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readUlwLoopPlan } from "../src/plan-io.js";
import { createAgentToolkit, ULW_LOOP_MANIFEST, type ULW_LOOP_OPERATIONS } from "../src/sdk.js";

const workDirs: string[] = [];
afterEach(async () => {
	for (const dir of workDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture(sessionId: string, surface: "omo-senpi" | "lazycodex" = "omo-senpi") {
	const cwd = await mkdtemp(join(tmpdir(), "ulw-dx-"));
	workDirs.push(cwd);
	const toolkit = createAgentToolkit({ cwd, sessionId, surface });
	const created = await toolkit.createGoals({ brief: "- alpha goal\n- beta goal" });
	if (!created.ok) throw new Error("fixture could not create goals");
	return { cwd, toolkit };
}

describe("help() is self-describing", () => {
	it("#given the manifest #when read #then every operation carries its camelCase method, a description, and an args map", () => {
		const methods: Record<(typeof ULW_LOOP_OPERATIONS)[number], string> = {
			help: "help",
			"create-goals": "createGoals",
			status: "status",
			"complete-goals": "completeGoals",
			checkpoint: "checkpoint",
			steer: "steer",
			"add-goal": "addGoal",
			criteria: "criteria",
			"record-evidence": "recordEvidence",
			"record-review-blockers": "recordReviewBlockers",
		};
		for (const operation of ULW_LOOP_MANIFEST.operations) {
			expect(operation.method).toBe(methods[operation.name]);
			expect(operation.description.length).toBeGreaterThan(20);
			expect(typeof operation.args).toBe("object");
		}
		const record = ULW_LOOP_MANIFEST.operations.find((operation) => operation.name === "record-evidence");
		expect(record?.args).toMatchObject({ goalId: "string", criterionId: "string", evidence: "string" });
		expect(Object.keys(record?.args ?? {})).toEqual(expect.arrayContaining(["status", "notes", "artifacts"]));
		const add = ULW_LOOP_MANIFEST.operations.find((operation) => operation.name === "add-goal");
		expect(Object.keys(add?.args ?? {})).toEqual(expect.arrayContaining(["title", "objective", "successCriteria"]));
		const steer = ULW_LOOP_MANIFEST.operations.find((operation) => operation.name === "steer");
		expect(Object.keys(steer?.args ?? {})).toEqual(
			expect.arrayContaining([
				"kind",
				"source",
				"evidence",
				"rationale",
				"goalId",
				"criterionId",
				"scenario",
				"expectedEvidence",
			]),
		);
	});

	it("#given a toolkit #when help() runs #then the result is the manifest", async () => {
		const { toolkit } = await fixture("dx-help");
		const help = await toolkit.help();
		expect(help.ok).toBe(true);
		if (help.ok) expect(help.result.operations.map((operation) => operation.method)).toContain("recordEvidence");
	});
});

describe("addGoal accepts success criteria", () => {
	it("#given explicit successCriteria #when the goal is added #then exactly those criteria persist with sequential ids", async () => {
		const { cwd, toolkit } = await fixture("dx-add-criteria");
		const added = await toolkit.addGoal({
			title: "lane",
			objective: "ship the lane",
			successCriteria: [
				{ scenario: "curl -i /health returns 200", expectedEvidence: "status line captured in health.log" },
				{
					scenario: "malformed body returns 400",
					expectedEvidence: "curl transcript",
					userModel: "edge",
					essential: false,
				},
			],
		});
		expect(added.ok).toBe(true);
		if (!added.ok) return;
		expect(added.result.goal.successCriteria).toEqual([
			expect.objectContaining({
				id: "C001",
				scenario: "curl -i /health returns 200",
				expectedEvidence: "status line captured in health.log",
				userModel: "happy",
				essential: true,
				status: "pending",
			}),
			expect.objectContaining({
				id: "C002",
				scenario: "malformed body returns 400",
				userModel: "edge",
				essential: false,
				status: "pending",
			}),
		]);
		const plan = await readUlwLoopPlan(cwd, { sessionId: "dx-add-criteria" });
		expect(plan.goals.at(-1)?.successCriteria).toHaveLength(2);
	});

	it("#given invalid successCriteria #when the goal is added #then the call fails closed with ULW_LOOP_ARGUMENT_INVALID and nothing persists", async () => {
		const { cwd, toolkit } = await fixture("dx-add-invalid");
		const attempts = [
			{ successCriteria: [] },
			{ successCriteria: [{ scenario: "  ", expectedEvidence: "x" }] },
			{ successCriteria: [{ scenario: "s", expectedEvidence: "" }] },
			{ successCriteria: [{ scenario: "s", expectedEvidence: "e", userModel: "vibes" }] },
		];
		for (const attempt of attempts) {
			const added = await toolkit.addGoal({
				title: "lane",
				objective: "ship the lane",
				...(attempt as { successCriteria: never }),
			});
			expect(added.ok).toBe(false);
			if (!added.ok) expect(added.error.code).toBe("ULW_LOOP_ARGUMENT_INVALID");
		}
		const plan = await readUlwLoopPlan(cwd, { sessionId: "dx-add-invalid" });
		expect(plan.goals).toHaveLength(2);
	});

	it("#given no successCriteria #when the goal is added #then the placeholders name the exact surface call", async () => {
		const senpi = await fixture("dx-add-placeholder", "omo-senpi");
		const added = await senpi.toolkit.addGoal({ title: "lane", objective: "ship the lane" });
		expect(added.ok).toBe(true);
		if (!added.ok) return;
		const placeholder = added.result.goal.successCriteria[0]?.expectedEvidence ?? "";
		expect(placeholder).toContain('agentToolkit.steer({ kind: "revise_criterion"');
		expect(placeholder).toContain(`goalId: "${added.result.goal.id}"`);
		expect(placeholder).toContain('criterionId: "C001"');
		expect(placeholder).toContain("successCriteria");
		expect(placeholder).not.toContain("Replace via revise_criterion with");

		const codex = await fixture("dx-add-placeholder-cli", "lazycodex");
		const cliAdded = await codex.toolkit.addGoal({ title: "lane", objective: "ship the lane" });
		expect(cliAdded.ok).toBe(true);
		if (cliAdded.ok) {
			expect(cliAdded.result.goal.successCriteria[0]?.expectedEvidence).toContain(
				`omo-agent-toolkit ulw-loop steer --kind revise_criterion --goal-id ${cliAdded.result.goal.id} --criterion-id C001`,
			);
		}
	});
});

describe("recordEvidence binds artifacts", () => {
	it("#given existing artifact paths #when evidence is recorded #then repo-relative paths persist on the criterion and the ledger", async () => {
		const { cwd, toolkit } = await fixture("dx-artifacts");
		await mkdir(join(cwd, "evidence"), { recursive: true });
		await writeFile(join(cwd, "evidence", "gate.log"), "exit 0\n");
		const outside = join(await mkdtemp(join(tmpdir(), "ulw-dx-outside-")), "shot.png");
		workDirs.push(join(outside, ".."));
		await writeFile(outside, "png");
		const started = await toolkit.completeGoals({});
		if (!started.ok || started.operation !== "complete-goals" || "done" in started.result) throw new Error("fixture");
		const goalId = started.result.goal.id;
		const recorded = await toolkit.recordEvidence({
			goalId,
			criterionId: "C001",
			status: "pass",
			evidence: "gate green",
			artifacts: ["evidence/gate.log", join(cwd, "evidence", "gate.log"), outside],
		});
		expect(recorded.ok).toBe(true);
		if (!recorded.ok) return;
		expect(recorded.result.criterion.artifacts).toEqual(["evidence/gate.log", outside]);
		expect(recorded.result.ledgerEntry.artifacts).toEqual(["evidence/gate.log", outside]);
		const ledger = (await readFile(join(cwd, ".omo", "ulw-loop", "dx-artifacts", "ledger.jsonl"), "utf8"))
			.trim()
			.split("\n");
		expect(ledger.at(-1)).toContain('"artifacts":["evidence/gate.log"');
	});

	it("#given a missing artifact #when evidence is recorded #then it fails with ULW_LOOP_EVIDENCE_ARTIFACT_MISSING naming the path and records nothing", async () => {
		const { cwd, toolkit } = await fixture("dx-artifact-missing");
		const started = await toolkit.completeGoals({});
		if (!started.ok || started.operation !== "complete-goals" || "done" in started.result) throw new Error("fixture");
		const goalId = started.result.goal.id;
		const recorded = await toolkit.recordEvidence({
			goalId,
			criterionId: "C001",
			status: "pass",
			evidence: "gate green",
			artifacts: ["evidence/does-not-exist.log"],
		});
		expect(recorded.ok).toBe(false);
		if (!recorded.ok) {
			expect(recorded.error.code).toBe("ULW_LOOP_EVIDENCE_ARTIFACT_MISSING");
			expect(recorded.error.message).toContain("evidence/does-not-exist.log");
		}
		const plan = await readUlwLoopPlan(cwd, { sessionId: "dx-artifact-missing" });
		expect(plan.goals[0]?.successCriteria[0]?.status).toBe("pending");
	});
});

describe("status() exposes a stable evidence root", () => {
	it("#given a session-scoped plan #when status runs #then evidenceRoot is the plan-level directory beside the moving attempt dir", async () => {
		const { toolkit } = await fixture("dx-evidence-root");
		const before = await toolkit.status();
		expect(before.ok).toBe(true);
		if (before.ok) expect(before.result.evidenceRoot).toBe(".omo/evidence/ulw/dx-evidence-root");
		await toolkit.completeGoals({});
		const after = await toolkit.status();
		expect(after.ok).toBe(true);
		if (after.ok) {
			expect(after.result.evidenceRoot).toBe(".omo/evidence/ulw/dx-evidence-root");
			expect(after.result.currentAttemptDir).toMatch(
				/^\.omo\/evidence\/ulw\/dx-evidence-root\/G001-alpha-goal\/a\d+$/,
			);
		}
	});
});
