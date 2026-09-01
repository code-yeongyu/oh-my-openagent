import { describe, expect, it } from "vitest";

import { configFromEnvironment } from "../src/config.js";

const REMOVED_AGENT_DOC_SOURCE_LISTS = ["AGENTS.md", "CLAUDE.md", "AGENTS.md,CLAUDE.md"] as const;

describe("rules config", () => {
	for (const sourceList of REMOVED_AGENT_DOC_SOURCE_LISTS) {
		it(`#given removed agent-doc source ${sourceList} #when parsing enabled sources #then preserves the explicit empty allowlist`, () => {
			// given
			const env = {
				CODEX_RULES_ENABLED_SOURCES: sourceList,
			} satisfies NodeJS.ProcessEnv;

			// when
			const config = configFromEnvironment(env);

			// then
			expect(config.enabledSources).toEqual([]);
		});
	}
});
