import { describe, expect, it } from "bun:test";

import { formatStaticBlock } from "./formatter.js";
import type { LoadedRule, MatchReason, RuleSource } from "./types.js";

describe("engine formatStaticBlock", () => {
	it("#given a project rule under a hephaestus directory #when formatting under a 200 byte budget #then it keeps normal order and truncates the body", () => {
		// given
		const tailMarker = "PROJECT_HEPHAESTUS_TAIL_SENTINEL";
		const alphaRule = loadedRule({
			path: "/repo/.omo/rules/alpha.md",
			relativePath: ".omo/rules/alpha.md",
			body: "Alpha guidance.",
		});
		const projectHephaestusRule = loadedRule({
			path: "/repo/.omo/rules/hephaestus/large.md",
			relativePath: ".omo/rules/hephaestus/large.md",
			body: `Project Hephaestus rule ${"H".repeat(600)} ${tailMarker}`,
		});

		// when
		const block = formatStaticBlock([alphaRule, projectHephaestusRule], {
			maxRuleChars: 120,
			maxResultChars: 200,
		});

		// then
		expect(block).toContain("Alpha guidance.");
		expect(block).toContain("Project Hephaestus rule");
		expect(block.indexOf("Alpha guidance.") < block.indexOf("Project Hephaestus rule")).toBe(true);
		expect(block).not.toContain(tailMarker);
		expect(block).toContain("[Truncated. Full: .omo/rules/hephaestus/large.md]");
	});
});

function loadedRule(input: {
	readonly body: string;
	readonly path: string;
	readonly relativePath: string;
	readonly source?: RuleSource;
	readonly matchReason?: MatchReason;
}): LoadedRule {
	return {
		path: input.path,
		realPath: input.path,
		source: input.source ?? ".omo/rules",
		distance: 0,
		isGlobal: false,
		isSingleFile: true,
		relativePath: input.relativePath,
		frontmatter: {},
		body: input.body,
		contentHash: input.relativePath,
		matchReason: input.matchReason ?? "single-file",
	};
}
