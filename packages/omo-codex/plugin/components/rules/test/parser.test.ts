import { describe, expect, it } from "vitest";

import { parseRule } from "@oh-my-opencode/rules-engine/engine";

describe("parseRule", () => {
	it("#given content without frontmatter #when parsing #then body is preserved", () => {
		// given
		const content = "Prefer strict TypeScript.\n---\nThis is body content.";

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed).toEqual({
			frontmatter: {},
			body: content,
		});
	});

	it("#given bom and crlf frontmatter #when parsing #then delimiters are removed", () => {
		// given
		const content = "\uFEFF---\r\ndescription: Windows rule\r\nalwaysApply: true\r\n---\r\nUse Git Bash.\r\n";

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed).toEqual({
			frontmatter: {
				description: "Windows rule",
				alwaysApply: true,
			},
			body: "Use Git Bash.\r\n",
		});
	});

	it("#given missing closing delimiter #when parsing #then original markdown is salvaged with diagnostic", () => {
		// given
		const content = ["---", "description: Missing close", "", "Keep this content."].join("\n");

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed).toEqual({
			frontmatter: {},
			body: content,
			diagnostic: "Missing closing frontmatter delimiter",
		});
	});

	it("#given malformed yaml subset #when parsing #then original markdown is salvaged with diagnostic", () => {
		// given
		const content = ["---", "alwaysApply: maybe", "---", "", "Keep this content."].join("\n");

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed.frontmatter).toEqual({});
		expect(parsed.body).toBe(content);
		expect(parsed.diagnostic).toBe("Malformed frontmatter: Expected boolean on line 1");
	});

	it("#given quoted hashes and inline quoted commas #when parsing #then comments and commas are handled by quote context", () => {
		// given
		const content = [
			"---",
			'description: "Rule #1" # trailing comment',
			'globs: ["src/a,b.ts", "docs/#guide.md"] # trailing comment',
			"---",
			"",
			"Use quote-aware parsing.",
		].join("\n");

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed.frontmatter).toEqual({
			description: "Rule #1",
			globs: ["src/a,b.ts", "docs/#guide.md"],
		});
	});

	it("#given quoted scalar glob with comma #when parsing #then the comma remains part of one glob", () => {
		// given
		const content = ["---", 'globs: "src/foo,bar.ts"', "---", "", "Prefer precise glob parsing."].join("\n");

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed.frontmatter.globs).toBe("src/foo,bar.ts");
	});

	it("#given unquoted scalar glob list with comma #when parsing #then it remains split into multiple globs", () => {
		// given
		const content = ["---", "globs: src/foo.ts, src/bar.ts", "---", "", "Prefer precise glob parsing."].join("\n");

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed.frontmatter.globs).toEqual(["src/foo.ts", "src/bar.ts"]);
	});

	it("#given multiline array with comments and blanks #when parsing #then items are collected until next key", () => {
		// given
		const content = [
			"---",
			"globs:",
			"  # ignored comment",
			"",
			'  - "src/#hash.ts" # trailing comment',
			"  - docs/**/*.md",
			"description: Multiline",
			"---",
			"",
			"Prefer precise rules.",
		].join("\n");

		// when
		const parsed = parseRule(content);

		// then
		expect(parsed.frontmatter).toEqual({
			description: "Multiline",
			globs: ["src/#hash.ts", "docs/**/*.md"],
		});
	});

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
