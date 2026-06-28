import { describe, expect, it } from "bun:test";

import { parseRule } from "./parser.js";

describe("parseRule", () => {
	it("#given quoted comma-separated glob scalar #when parsing #then glob aliases split into ordered patterns", () => {
		// given
		const content = [
			"---",
			'globs: "*.md"',
			'paths: "src/**/*.ts, test/**/*.ts"',
			'applyTo: "docs/**/*.md, src/**/*.ts"',
			"---",
			"",
			"Prefer project rules.",
		].join("\n");

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed.frontmatter.globs).toEqual(["*.md", "src/**/*.ts", "test/**/*.ts", "docs/**/*.md"]);
		expect(parsed.body).toBe("\nPrefer project rules.");
	});

	it("#given inline array item contains comma #when parsing #then the quoted item remains one glob", () => {
		// given
		const content = [
			"---",
			'applyTo: ["docs/{draft,final}.md", "src/**/*.ts"]',
			"---",
			"Prefer scoped rules.",
		].join("\n");

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed.frontmatter.globs).toEqual(["docs/{draft,final}.md", "src/**/*.ts"]);
	});
});
