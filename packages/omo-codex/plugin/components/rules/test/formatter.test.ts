import type { LoadedRule, MatchReason, RuleSource } from "@oh-my-opencode/rules-engine/engine";
import { formatDynamicBlock, formatStaticBlock } from "@oh-my-opencode/rules-engine/engine";
import { describe, expect, it } from "vitest";

const FORMAT_OPTIONS = {
	maxRuleChars: 10_000,
	maxResultChars: 10_000,
};

// Runtime sentinel: the rules hook emits and re-greps this marker when
// deduplicating injected rules against the transcript (transcript-rule-filter.ts).
const INSTRUCTIONS_FROM = "Instructions from: ";

describe("rules formatter hook context", () => {
	it("#given multiline dynamic rules #when formatting PostToolUse context #then labels and bodies render on separate lines", () => {
		// given
		const body = "DYN_BODY_SENTINEL_LINE_1\n\nDYN_BODY_SENTINEL_LINE_2";
		const rule = loadedRule({
			path: "/repo/packages/CONTEXT.md",
			relativePath: "packages/CONTEXT.md",
			body,
		});

		// when
		const block = formatDynamicBlock(
			[rule],
			"packages/omo-codex/plugin/components/ulw-loop/src/paths.ts",
			FORMAT_OPTIONS,
		);

		// then
		expect(block).toContain(`${INSTRUCTIONS_FROM}/repo/packages/CONTEXT.md\n\n${body}`);
		expect(occurrenceCount(block, INSTRUCTIONS_FROM)).toBe(1);
	});

	it("#given static rules #when formatting SessionStart context #then it injects rule bodies inline", () => {
		// given
		const body = "STATIC_BODY_SENTINEL";
		const rule = loadedRule({
			path: "/repo/CONTEXT.md",
			relativePath: "CONTEXT.md",
			body,
		});

		// when
		const block = formatStaticBlock([rule], FORMAT_OPTIONS);

		// then
		expect(block).toContain(`${INSTRUCTIONS_FROM}/repo/CONTEXT.md\n\n${body}`);
	});

	it("#given CRLF and bare CR rule bodies #when formatting context #then it normalizes line endings", () => {
		// given
		const rule = loadedRule({
			body: "A1\r\n  B2\rC3",
		});

		// when
		const block = formatDynamicBlock([rule], "src/app.ts", FORMAT_OPTIONS);

		// then
		expect(block).toContain("A1\n  B2\nC3");
		expect(block).not.toContain("\r");
	});

	it("#given duplicate static rules with different line endings #when formatting context #then it injects one copy", () => {
		// given
		const sharedBody = "SHARED_L1\r\nSHARED_L2";
		const normalizedSharedBody = "SHARED_L1\nSHARED_L2";
		const lfRule = loadedRule({
			path: "/repo/CONTEXT.md",
			relativePath: "CONTEXT.md",
			body: normalizedSharedBody,
		});
		const crlfRule = loadedRule({
			path: "/repo/packages/CONTEXT.md",
			relativePath: "packages/CONTEXT.md",
			body: sharedBody,
		});

		// when
		const block = formatStaticBlock([lfRule, crlfRule], FORMAT_OPTIONS);

		// then
		expect(occurrenceCount(block, `${INSTRUCTIONS_FROM}/repo/CONTEXT.md`)).toBe(1);
		expect(occurrenceCount(block, normalizedSharedBody)).toBe(1);
		expect(block).not.toContain("/repo/packages/CONTEXT.md");
	});

	it("#given a Hephaestus static rule #when formatting SessionStart context #then it injects its body before other rule bodies", () => {
		// given
		const rules = [
			loadedRule({ path: "/repo/alpha.md", relativePath: "alpha.md", body: "ALPHA_BODY_SENTINEL" }),
			loadedRule({
				path: "/repo/bundled-rules/hephaestus.md",
				relativePath: "bundled-rules/hephaestus.md",
				body: "HEPHAESTUS_BODY_SENTINEL",
			}),
			loadedRule({ path: "/repo/beta.md", relativePath: "beta.md", body: "BETA_BODY_SENTINEL" }),
		];

		// when
		const block = formatStaticBlock(rules, FORMAT_OPTIONS);

		// then
		expect(block).toContain(`${INSTRUCTIONS_FROM}/repo/bundled-rules/hephaestus.md`);
		expect(block).toContain("HEPHAESTUS_BODY_SENTINEL");
		expect(block).toContain("ALPHA_BODY_SENTINEL");
		expect(block).toContain("BETA_BODY_SENTINEL");
		expect(block.indexOf("HEPHAESTUS_BODY_SENTINEL")).toBeLessThan(block.indexOf("ALPHA_BODY_SENTINEL"));
		expect(block.indexOf("ALPHA_BODY_SENTINEL")).toBeLessThan(block.indexOf("BETA_BODY_SENTINEL"));
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
		expect(block).toContain(`${INSTRUCTIONS_FROM}/repo/alpha.md`);
		expect(block).toContain(`${INSTRUCTIONS_FROM}/repo/beta.md`);
		expect(block).toContain(`${INSTRUCTIONS_FROM}/repo/gamma.md`);
		expect(block).toContain("alpha-");
		expect(block).toContain("beta-");
		expect(block).toContain("gamma-");
		expect(block).not.toContain("A".repeat(400));
		expect(block).not.toContain("B".repeat(400));
		expect(block).not.toContain("C".repeat(400));
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
