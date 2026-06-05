import { describe, expect, it } from "vitest";

import { parseRule } from "../src/rules/parser.js";

describe("parseRule", () => {
	it("#given duplicate glob aliases #when parsing frontmatter #then first-seen order is preserved", () => {
		// given
		const content = [
			"---",
			'globs: ["src/**/*.ts", "test/**/*.ts", "src/**/*.ts"]',
			"paths:",
			"  - test/**/*.ts",
			"  - packages/**/*.ts",
			"applyTo: packages/**/*.ts, docs/**/*.md, src/**/*.ts",
			"---",
			"",
			"Prefer strict TypeScript.",
		].join("\n");

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed.frontmatter.globs).toEqual(["src/**/*.ts", "test/**/*.ts", "packages/**/*.ts", "docs/**/*.md"]);
	});
});
