import { describe, expect, it } from "bun:test";

import { isNeverTruncatedRule, truncateRule } from "./truncator";

describe("engine isNeverTruncatedRule", () => {
	describe("#given hephaestus rule paths", () => {
		it("#when the legacy flat filename is used #then it is never truncated", () => {
			expect(isNeverTruncatedRule("bundled-rules/hephaestus.md")).toBe(true);
		});

		it("#when a model variant lives under the hephaestus directory #then it is never truncated", () => {
			expect(isNeverTruncatedRule("bundled-rules/hephaestus/gpt-5.5.md")).toBe(true);
			expect(isNeverTruncatedRule("bundled-rules/hephaestus/gpt-5.6.md")).toBe(true);
		});

		it("#when a Windows-separated variant path is used #then it is never truncated", () => {
			expect(isNeverTruncatedRule("bundled-rules\\hephaestus\\gpt-5.6.md")).toBe(true);
		});
	});

	describe("#given non-hephaestus rule paths", () => {
		it("#when checked #then they remain truncatable", () => {
			expect(isNeverTruncatedRule("bundled-rules/windows-git-bash.md")).toBe(false);
			expect(isNeverTruncatedRule(".omo/rules/typescript.md")).toBe(false);
			expect(isNeverTruncatedRule(".omo/rules/hephaestus/large.md")).toBe(false);
			expect(isNeverTruncatedRule("bundled-rules/hephaestus/future.md")).toBe(false);
		});
	});

	describe("#given a hephaestus variant body larger than the budget", () => {
		it("#when truncateRule runs #then the body is kept in full", () => {
			const body = "A".repeat(10_000);

			const result = truncateRule(body, {
				maxChars: 100,
				relativePath: "bundled-rules/hephaestus/gpt-5.6.md",
			});

			expect(result.truncated).toBe(false);
			expect(result.body).toBe(body);
		});
	});
});
