import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const SKILL_URL = new URL("../skills/ulw-loop/SKILL.md", import.meta.url);
const FULL_WORKFLOW_URL = new URL("../skills/ulw-loop/references/full-workflow.md", import.meta.url);

function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

describe("ulw-loop skill contract", () => {
	it("#given full workflow #when tier triage is inspected #then criteria scale by LIGHT/HEAVY with upgrade-only ratchet", async () => {
		// given
		const workflow = await readFile(FULL_WORKFLOW_URL, "utf8");

		// then
		expect(workflow).toMatch(/[Tt]ier triage/);
		expect(workflow).toMatch(/LIGHT/);
		expect(workflow).toMatch(/HEAVY/);
		expect(workflow).toMatch(/1-2 successCriteria/);
		expect(workflow).toMatch(/3\+ criteria|3\+ successCriteria/);
		expect(workflow).toMatch(/When unsure[^.]{0,30}HEAVY/);
		expect(workflow).toMatch(/never downgrade/i);
	});

	it("#given full workflow #when evidence rules are inspected #then tautological tests are rejected and the light quality gate is named", async () => {
		// given
		const workflow = await readFile(FULL_WORKFLOW_URL, "utf8");

		// then
		expect(workflow).toMatch(/mirrors its implementation/);
		expect(workflow).toMatch(/none-applicable/);
	});

	it("#given full workflow #when checkpoint guidance is inspected #then non-final and final criteria gates differ", async () => {
		// given
		const workflow = await readFile(FULL_WORKFLOW_URL, "utf8");

		// then
		expect(workflow).toMatch(/non-final aggregate goal[^.]+essential[^.]+pass/i);
		expect(workflow).toMatch(/non-essential criteria may remain pending/i);
		expect(workflow).toMatch(/final aggregate goal[^.]+every criterion across the whole plan/i);
		expect(workflow).toMatch(/final aggregate completion requires all criteria across the whole plan/i);
		expect(workflow).toMatch(/5 cycles on one goal without required criteria passing/i);
	});

	it("#given full workflow #when echo discipline is inspected #then the ultraqa class list is enumerated once and budgets hold", async () => {
		// given
		const workflow = await readFile(FULL_WORKFLOW_URL, "utf8");
		const skill = await readFile(SKILL_URL, "utf8");

		// then
		expect(workflow.match(/malformed input, prompt injection/g)?.length ?? 0).toBe(1);
		expect(wordCount(workflow)).toBeLessThanOrEqual(3544);
		expect(wordCount(skill)).toBeLessThanOrEqual(611);
	});
});
