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
});
