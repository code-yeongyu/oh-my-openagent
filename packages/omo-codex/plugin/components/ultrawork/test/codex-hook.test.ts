import { describe, expect, it } from "vitest";

import { isUltraworkPrompt, runUserPromptSubmitHook } from "../src/codex-hook.js";

describe("codex ultrawork hook", () => {
	it("#given ultrawork prompt #when hook runs #then emits directive", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please ulw this change",
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toMatch(/^<ultrawork-mode>/);
		expect(output).toMatch(/First user-visible line this turn MUST be exactly:/);
	});

	it("#given identifier-like ulw #when hook runs #then does not emit directive", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "refactor ulw_helper.ts",
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
		expect(isUltraworkPrompt("ulw_helper.ts")).toBe(false);
	});

	it("#given malformed or empty input #when hook runs #then exits with empty output", () => {
		// given
		const inputs = [undefined, {}, { hook_event_name: "UserPromptSubmit", prompt: "" }] as const;

		// when
		const outputs = inputs.map((input) => runUserPromptSubmitHook(input));

		// then
		expect(outputs).toEqual(["", "", ""]);
	});

	it("#given directive #when inspected #then keeps manual QA and cleanup invariants", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please ultrawork",
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toMatch(/# Manual-QA channels/);
		expect(output).toMatch(/TESTS ALONE NEVER PROVE DONE/);
		expect(output).toMatch(/1\. HTTP call/);
		expect(output).toMatch(/2\. tmux/);
		expect(output).toMatch(/3\. Browser use/);
		expect(output).toMatch(/4\. Computer use/);
		expect(output).toMatch(/CLEANUP \(PAIRED/);
	});
});
