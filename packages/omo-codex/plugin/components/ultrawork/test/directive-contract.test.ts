import { describe, expect, it } from "vitest";

import { ULTRAWORK_DIRECTIVE } from "../src/directive.js";

describe("ultrawork directive contract", () => {
	it("#given directive text #when create_goal guidance is inspected #then the payload contract is objective-only", () => {
		// given
		const directive = ULTRAWORK_DIRECTIVE;

		// when
		const createGoalSection = directive.slice(directive.indexOf("## 1. Create the goal"));

		// then
		expect(createGoalSection).toMatch(/exactly `objective`/);
		expect(createGoalSection).toMatch(/Do not include `status`/);
		expect(createGoalSection).not.toMatch(/`objective` and `status`/);
	});

	it("#given directive text #when tier triage is inspected #then LIGHT defaults with fact-based HEAVY escalation", () => {
		// given
		const directive = ULTRAWORK_DIRECTIVE;

		// then
		expect(directive).toMatch(/# Tier triage/);
		expect(directive).toMatch(/Default is LIGHT/);
		expect(directive).toMatch(/auth/i);
		expect(directive).toMatch(/schema or migration|DB schema/i);
		expect(directive).toMatch(/concurrency/i);
		expect(directive).toMatch(/new module/i);
		expect(directive).toMatch(/When unsure, take HEAVY/);
		expect(directive).toMatch(/never downgrade/i);
	});

	it("#given directive text #when evidence rules are inspected #then failing-first proof replaces unconditional TDD and tautological tests are rejected", () => {
		// given
		const directive = ULTRAWORK_DIRECTIVE;

		// then
		expect(directive).toMatch(/cheapest faithful channel/);
		expect(directive).toMatch(/mirrors its implementation/);
		expect(directive).toMatch(/tautological/i);
		expect(directive).not.toMatch(/No "too small", "too obvious"/);
	});

	it("#given directive text #when the verification gate is inspected #then the trigger is tier-based instead of coarse counts", () => {
		// given
		const directive = ULTRAWORK_DIRECTIVE;
		const gateSection = directive.slice(directive.indexOf("# Verification gate"));

		// then
		expect(gateSection).toMatch(/Tier is HEAVY/);
		expect(directive).not.toMatch(/3\+ files OR/);
	});

	it("#given directive text #when echo discipline is inspected #then the tests-alone rule is stated exactly once and the budget holds", () => {
		// given
		const directive = ULTRAWORK_DIRECTIVE;

		// then
		expect(directive.match(/TESTS ALONE NEVER PROVE DONE/g)?.length ?? 0).toBe(1);
		expect(directive).not.toMatch(/is NEVER verification on its own/);
		expect(directive.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(2813);
	});
});
