import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

	it("#given Codex TOML rule disable switches #when parsing config #then disabled rule ids are normalized", () => {
		// given
		const codexHome = mkdtempSync(join(tmpdir(), "codex-rules-config-home-"));
		try {
			writeFileSync(
				join(codexHome, "config.toml"),
				[
					'[plugins."omo@sisyphuslabs".rules.hephaestus]',
					"enabled = false",
					"",
					'[plugins."omo@sisyphuslabs".rules."windows-git-bash"]',
					"enabled = false",
					"",
				].join("\n"),
			);

			// when
			const config = configFromEnvironment({ CODEX_HOME: codexHome });

			// then
			expect([...config.disabledRuleIds].sort()).toEqual(["hephaestus", "windows_git_bash"]);
		} finally {
			rmSync(codexHome, { recursive: true, force: true });
		}
	});
});
