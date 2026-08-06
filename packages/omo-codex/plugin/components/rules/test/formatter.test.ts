import { describe, expect, it } from "vitest";

import { formatDynamicBlock, formatStaticBlock } from "@oh-my-opencode/rules-engine/engine";
import type { LoadedRule, MatchReason, RuleSource } from "@oh-my-opencode/rules-engine/engine";

const FORMAT_OPTIONS = {
	maxRuleChars: 10_000,
	maxResultChars: 10_000,
};

describe("rules formatter hook context", () => {
	it("#given multiline dynamic rules #when formatting PostToolUse context #then labels and bodies render on separate lines", () => {
		// given
		const rule = loadedRule({
			path: "/repo/packages/CONTEXT.md",
			relativePath: "packages/CONTEXT.md",
			body: ["# packages", "", "## OVERVIEW", "23 sibling packages.", "", "## CONVENTIONS", "Use npm."].join("\n"),
		});

		// when
		const block = formatDynamicBlock(
			[rule],
			"packages/omo-codex/plugin/components/ulw-loop/src/paths.ts",
			FORMAT_OPTIONS,
		);

		// then
		expect(block).toBe(
			[
				"Additional project instructions matched for packages/omo-codex/plugin/components/ulw-loop/src/paths.ts:",
				"",
				"Instructions from: /repo/packages/CONTEXT.md",
				"",
				"# packages",
				"",
				"## OVERVIEW",
				"23 sibling packages.",
				"",
				"## CONVENTIONS",
				"Use npm.",
			].join("\n"),
		);
	});

	it("#given static rules #when formatting SessionStart context #then it injects rule bodies inline", () => {
		// given
		const rule = loadedRule({
			path: "/repo/CONTEXT.md",
			relativePath: "CONTEXT.md",
			body: "Keep generated hook context readable.",
		});

		// when
		const block = formatStaticBlock([rule], FORMAT_OPTIONS);

		// then
		expect(block).toBe(
			[
				"## Project Instructions",
				"",
				"Instructions from: /repo/CONTEXT.md",
				"",
				"Keep generated hook context readable.",
			].join("\n"),
		);
	});

	it("#given CRLF and bare CR rule bodies #when formatting context #then it normalizes line endings", () => {
		// given
		const rule = loadedRule({
			body: "First line\r\n  indented second line\rThird line",
		});

		// when
		const block = formatDynamicBlock([rule], "src/app.ts", FORMAT_OPTIONS);

		// then
		expect(block).toContain("First line\n  indented second line\nThird line");
		expect(block).not.toContain("\r");
	});

	it("#given duplicate static rules with different line endings #when formatting context #then it injects one copy", () => {
		// given
		const lfRule = loadedRule({
			path: "/repo/CONTEXT.md",
			relativePath: "CONTEXT.md",
			body: "Shared rule\nKeep one copy.",
		});
		const crlfRule = loadedRule({
			path: "/repo/packages/CONTEXT.md",
			relativePath: "packages/CONTEXT.md",
			body: "Shared rule\r\nKeep one copy.",
		});

		// when
		const block = formatStaticBlock([lfRule, crlfRule], FORMAT_OPTIONS);

		// then
		expect(occurrenceCount(block, "Instructions from: /repo/CONTEXT.md")).toBe(1);
		expect(occurrenceCount(block, "Shared rule\nKeep one copy.")).toBe(1);
		expect(block).not.toContain("/repo/packages/CONTEXT.md");
	});

	it("#given a Hephaestus static rule #when formatting SessionStart context #then it injects its body before other rule bodies", () => {
		// given
		const rules = [
			loadedRule({ path: "/repo/alpha.md", relativePath: "alpha.md", body: "Alpha guidance." }),
			loadedRule({
				path: "/repo/bundled-rules/hephaestus.md",
				relativePath: "bundled-rules/hephaestus.md",
				body: "Hephaestus guidance.",
			}),
			loadedRule({ path: "/repo/beta.md", relativePath: "beta.md", body: "Beta guidance." }),
		];

		// when
		const block = formatStaticBlock(rules, FORMAT_OPTIONS);

		// then
		expect(block).toContain("Instructions from: /repo/bundled-rules/hephaestus.md");
		expect(block).toContain("Hephaestus guidance.");
		expect(block).toContain("Alpha guidance.");
		expect(block).toContain("Beta guidance.");
		expect(block.indexOf("Hephaestus guidance.")).toBeLessThan(block.indexOf("Alpha guidance."));
		expect(block.indexOf("Alpha guidance.")).toBeLessThan(block.indexOf("Beta guidance."));
		expect(block).not.toContain("must read project rules:");
		expect(block).not.toContain("- [hephaestus.md]");
	});

	it("#given only a Hephaestus static rule #when formatting SessionStart context #then it emits no project rule link section", () => {
		// given
		const rule = loadedRule({
			path: "/repo/bundled-rules/hephaestus.md",
			relativePath: "bundled-rules/hephaestus.md",
			body: "Hephaestus guidance.",
		});

		// when
		const block = formatStaticBlock([rule], FORMAT_OPTIONS);

		// then
		expect(block).toContain("Instructions from: /repo/bundled-rules/hephaestus.md");
		expect(block).toContain("Hephaestus guidance.");
		expect(block).not.toContain("- [hephaestus.md]");
		expect(block).not.toContain("must read project rules:");
	});

	it("#given an oversized Hephaestus static rule #when formatting under a tight result budget #then its body is never truncated", () => {
		// given
		const tailMarker = "HEPHAESTUS_TAIL_SENTINEL";
		const rule = loadedRule({
			path: "/repo/bundled-rules/hephaestus.md",
			relativePath: "bundled-rules/hephaestus.md",
			body: `${"H".repeat(500)}\n\n${tailMarker}`,
		});

		// when
		const block = formatStaticBlock([rule], {
			maxRuleChars: 120,
			maxResultChars: 200,
		});

		// then
		expect(block).toContain(tailMarker);
		expect(block).not.toContain("[Truncated. Full:");
	});

	it("#given multiple oversized rules #when formatting under a tight result budget #then every rule receives a fair truncated share with a read-full guide", () => {
		// given
		const rules = [
			loadedRule({ path: "/repo/alpha.md", relativePath: "alpha.md", body: `alpha-${"A".repeat(500)}` }),
			loadedRule({ path: "/repo/beta.md", relativePath: "beta.md", body: `beta-${"B".repeat(500)}` }),
			loadedRule({ path: "/repo/gamma.md", relativePath: "gamma.md", body: `gamma-${"C".repeat(500)}` }),
		];

		// when
		const block = formatDynamicBlock(rules, "src/app.ts", {
			maxRuleChars: 10_000,
			maxResultChars: 900,
		});

		// then
		expect(block).toContain("Instructions from: /repo/alpha.md");
		expect(block).toContain("Instructions from: /repo/beta.md");
		expect(block).toContain("Instructions from: /repo/gamma.md");
		expect(block).toContain("[Truncated. Full: alpha.md]");
		expect(block).toContain("[Truncated. Full: beta.md]");
		expect(block).toContain("[Truncated. Full: gamma.md]");
		expect(occurrenceCount(block, "[Truncated. Full:")).toBe(3);
	});

	it("#given no matching rules #when formatting hook context #then it emits no context", () => {
		// given
		const rules: LoadedRule[] = [];

		// when
		const dynamicBlock = formatDynamicBlock(rules, "src/app.ts", FORMAT_OPTIONS);
		const staticBlock = formatStaticBlock(rules, FORMAT_OPTIONS);

		// then
		expect(dynamicBlock).toBe("");
		expect(staticBlock).toBe("");
	});
});

function loadedRule(input: {
	readonly body: string;
	readonly path?: string;
	readonly relativePath?: string;
	readonly source?: RuleSource;
	readonly matchReason?: MatchReason;
}): LoadedRule {
	const path = input.path ?? "/repo/CONTEXT.md";
	const relativePath = input.relativePath ?? "CONTEXT.md";
	const source = input.source ?? "CONTEXT.md";
	return {
		path,
		realPath: path,
		source,
		distance: 0,
		isGlobal: false,
		isSingleFile: true,
		relativePath,
		frontmatter: {},
		body: input.body,
		contentHash: "hash",
		matchReason: input.matchReason ?? "single-file",
	};
}

function occurrenceCount(value: string, search: string): number {
	return value.split(search).length - 1;
}
