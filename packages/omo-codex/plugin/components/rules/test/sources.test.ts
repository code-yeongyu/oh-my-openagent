import { describe, expect, it } from "vitest";

import { SOURCE_PRIORITY } from "../src/rules/constants.js";
import { defaultConfig } from "../src/rules/engine.js";
import { disabledSourcesFromConfig } from "../src/rules/sources.js";
import type { PiRulesConfig } from "../src/rules/types.js";

describe("rules source selection", () => {
	it("#given default config #when disabled sources are derived #then opt-out sources stay disabled", () => {
		// given
		const config = defaultConfig();
		const expected = new Set(["AGENTS.md", "~/.claude/rules", "~/.claude/CLAUDE.md"]);

		// when
		const disabledSources = disabledSourcesFromConfig(config);
		expect(disabledSources).toBeDefined();
		if (disabledSources === undefined) return;

		// then
		expect(disabledSources).toEqual(expected);
	});

	it("#given explicit enabled sources #when disabled source set is derived #then all other known sources are omitted", () => {
		// given
		const config: PiRulesConfig = {
			...defaultConfig(),
			enabledSources: [".omo/rules", "plugin-bundled"],
		};

		// when
		const disabledSources = disabledSourcesFromConfig(config);
		expect(disabledSources).toBeDefined();
		if (disabledSources === undefined) return;

		// then
		for (const source of [".omo/rules", "plugin-bundled"]) {
			expect(disabledSources.has(source)).toBe(false);
		}
		expect(disabledSources.has("~/.claude/rules")).toBe(true);
		expect(disabledSources).toEqual(
			new Set(
				[...SOURCE_PRIORITY.keys()].filter((source) => source !== ".omo/rules" && source !== "plugin-bundled"),
			),
		);
	});
});
