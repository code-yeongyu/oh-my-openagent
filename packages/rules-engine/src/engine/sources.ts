import { SOURCE_PRIORITY } from "./constants.js";
import type { PiRulesConfig } from "./types.js";

export const DEFAULT_AUTO_DISABLED_SOURCES: readonly string[] = ["AGENTS.md", "~/.claude/rules", "~/.claude/CLAUDE.md"];

export function disabledSourcesFromConfig(config: PiRulesConfig): ReadonlySet<string> | undefined {
	if (config.enabledSources === "auto") {
		return new Set(DEFAULT_AUTO_DISABLED_SOURCES);
	}

	const enabledSources = new Set(config.enabledSources);
	return new Set([...SOURCE_PRIORITY.keys()].filter((source) => !enabledSources.has(source)));
}
