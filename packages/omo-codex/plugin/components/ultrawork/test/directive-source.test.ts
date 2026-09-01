import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ULTRAWORK_DIRECTIVE } from "../src/directive.js";

describe("codex ultrawork directive source", () => {
	it("#given the generated bundled directive #when compared to prompts-core codex variant #then bytes match", () => {
		// given
		const codexPromptUrl = new URL(import.meta.resolve("@oh-my-opencode/prompts-core/prompts/ultrawork/codex.md"));

		// when
		const codexPrompt = readFileSync(codexPromptUrl, "utf8");

		// then
		// Freshness gate for the checked-in generated artifact: editing the canonical prompt without
		// re-running scripts/sync-directive.mjs leaves src/directive-content.ts stale and fails here.
		expect(ULTRAWORK_DIRECTIVE).toBe(codexPrompt);
	});

	it("#given the runtime directive module #when inspected #then it bundles the constant instead of reading markdown from disk", () => {
		// given
		const directiveSource = readFileSync(new URL("../src/directive.ts", import.meta.url), "utf8");

		// when
		const importsBundledConstant = directiveSource.includes(
			'import { ULTRAWORK_DIRECTIVE_TEXT } from "./directive-content.js"',
		);

		// then
		// prompts-core's contract: markdown is bundled at build time, never read from disk at runtime.
		expect(importsBundledConstant).toBe(true);
		expect(directiveSource).not.toMatch(/readFileSync|readFile\(/);
	});
});
