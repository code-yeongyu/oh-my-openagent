import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.js";
import { writePlan } from "../src/plan-io.js";
import { goal, plan } from "./fixtures/checkpoint-builders.js";

let repo: string;
let output: string[];

beforeEach(async () => {
	repo = await mkdtemp(join(tmpdir(), "ulw-template-"));
	output = [];
	vi.spyOn(process, "cwd").mockReturnValue(repo);
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		output.push(chunk.toString());
		return true;
	});
	delete process.env["OMO_AGENT_TOOLKIT_SURFACE"];
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(repo, { recursive: true, force: true });
});

async function run(args: string[]): Promise<Record<string, unknown>> {
	const code = await ulwLoopCommand(["checkpoint", ...args]);
	expect(code).toBe(0);
	return JSON.parse(output.join(""));
}

describe("checkpoint --print-template", () => {
	it("#given an active senpi v2 plan #when printed with only goal-id #then emits the senpi gate skeleton", async () => {
		await writePlan(
			repo,
			plan([goal({ id: "G001", attempt: 2 })], {
				evidenceLayoutVersion: 2,
				activeGoalId: "G001",
				codexObjective: "Exact objective from goals.json",
			}),
		);
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		const result = await run(["--print-template", "--goal-id", "G001", "--json"]);
		const gate = result["qualityGateTemplate"] as Record<string, unknown>;
		expect(Object.keys(gate)).toEqual(["manualQa", "gateReview", "iteration", "criteriaCoverage"]);
		expect((gate["manualQa"] as Record<string, unknown>)["by"]).toBe("main-session");
		expect((gate["gateReview"] as Record<string, unknown>)["by"]).toBe("category:deep");
		expect(result["codexGoalTemplate"]).toEqual({
			goal: { objective: "Exact objective from goals.json", status: "complete" },
		});
		expect(result["attemptDir"]).toBe(".omo/evidence/ulw/session/G001/a2");
	});

	it("#given an active v2 plan #when printed without any goal id #then targets the active goal", async () => {
		await writePlan(
			repo,
			plan([goal({ id: "G001", attempt: 1 })], {
				evidenceLayoutVersion: 2,
				activeGoalId: "G001",
				codexObjective: "Exact objective from goals.json",
			}),
		);
		process.env["OMO_AGENT_TOOLKIT_SURFACE"] = "omo-senpi";
		const result = await run(["--print-template", "--json"]);
		const gate = result["qualityGateTemplate"] as Record<string, unknown>;
		expect(Object.keys(gate)).toEqual(["manualQa", "gateReview", "iteration", "criteriaCoverage"]);
		expect(result["attemptDir"]).toBe(".omo/evidence/ulw/session/G001/a1");
	});

	it("#given two goals #when printed with an explicit non-active goal id #then targets that goal's attempt dir", async () => {
		await writePlan(
			repo,
			plan([goal({ id: "G001", attempt: 1 }), goal({ id: "G002", attempt: 3 })], {
				evidenceLayoutVersion: 2,
				activeGoalId: "G001",
				codexObjective: "Exact objective from goals.json",
			}),
		);
		const result = await run(["--print-template", "--goal-id", "G002", "--json"]);
		expect(result["attemptDir"]).toBe(".omo/evidence/ulw/session/G002/a3");
	});

	it("#given a v1 plan #when printed without status #then exits successfully and gives v1 guidance", async () => {
		await writePlan(repo, plan([goal({ id: "G001" })]));
		const result = await run(["--print-template", "--goal-id", "G001", "--json"]);
		expect(result["guidance"]).toContain("evidence-layout v1");
		expect(result).not.toHaveProperty("attemptDir");
	});
});
