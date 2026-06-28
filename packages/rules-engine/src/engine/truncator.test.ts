import { describe, expect, it } from "bun:test";

import { TRUNCATION_NOTICE } from "./constants.js";
import { isNeverTruncatedRule, truncateBudget, truncateRule } from "./truncator.js";

function notice(relativePath: string): string {
	return TRUNCATION_NOTICE.replace("{path}", relativePath);
}

describe("rules engine truncator", () => {
	it("#given Hephaestus rule paths #when checking never-truncate status #then only the filename controls the match", () => {
		// given
		const unixPath = "bundled-rules/Hephaestus.md";
		const windowsPath = "bundled-rules\\hephaestus.md";
		const siblingPath = "bundled-rules/hephaestus.md.backup";

		// when / then
		expect(isNeverTruncatedRule(unixPath)).toBe(true);
		expect(isNeverTruncatedRule(windowsPath)).toBe(true);
		expect(isNeverTruncatedRule(siblingPath)).toBe(false);
	});

	it("#given a truncation boundary inside an emoji #when truncating one rule #then it does not emit a dangling surrogate", () => {
		// given
		const relativePath = "rules/emoji.md";
		const body = `😀${"tail".repeat(20)}`;
		const maxChars = notice(relativePath).length + 1;

		// when
		const result = truncateRule(body, { maxChars, relativePath });

		// then
		expect(result.truncated).toBe(true);
		expect(result.originalLength).toBe(body.length);
		expect(result.body).toBe(notice(relativePath));
		expect(result.body).not.toContain("\uD83D");
	});

	it("#given an oversized Hephaestus rule #when applying a result budget #then the full rule is preserved", () => {
		// given
		const body = `${"Hephaestus guidance. ".repeat(20)}TAIL`;

		// when
		const result = truncateBudget({
			maxResultChars: 24,
			rules: [{ body, relativePath: "bundled-rules/hephaestus.md" }],
		});

		// then
		expect(result).toEqual([{ body, relativePath: "bundled-rules/hephaestus.md", truncated: false }]);
	});
});
