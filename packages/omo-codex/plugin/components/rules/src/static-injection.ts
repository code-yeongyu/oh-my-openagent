import type { CodexRulesHookOptions } from "./codex-hook-options.js";
import { configFromEnvironment } from "./config.js";
import { formatAdditionalContextOutput } from "./hook-output.js";
import { completePostCompactRecovery, hydrateEngineState, persistEngineState } from "./persistent-cache.js";
import { withPostCompactBudget } from "./post-compact-budget.js";
import { createRulesEngine } from "./rules-engine-factory.js";
import { filterRulesAlreadyInTranscript } from "./transcript-rule-filter.js";
import type { TranscriptSearchOptions } from "./transcript-search.js";

export function runStaticInjection(
	cwd: string,
	transcriptPath: string | null,
	eventName: "SessionStart" | "UserPromptSubmit",
	cachePath: string,
	options: CodexRulesHookOptions,
	completedPostCompactChannel?: "static",
	transcriptSearchOptions: TranscriptSearchOptions = {},
	model?: string,
): string {
	const config = configFromEnvironment(options.env);
	if (config.disabled || config.mode === "off" || config.mode === "dynamic") {
		if (completedPostCompactChannel !== undefined) {
			completePostCompactRecovery(cachePath, completedPostCompactChannel);
		}
		return "";
	}

	const effectiveConfig =
		completedPostCompactChannel === undefined
			? config
			: withPostCompactBudget(config, { model: model ?? "", transcriptPath });
	const engine = createRulesEngine(options, effectiveConfig);
	hydrateEngineState(engine, cachePath);
	engine.state.cwd = cwd;

	const loaded = engine.loadStaticRules(cwd);
	const rules = filterRulesAlreadyInTranscript(
		loaded.rules.filter((rule) => !engine.isStaticInjected(rule)),
		transcriptPath,
		(rule) => {
			engine.markStaticInjected(rule);
		},
		transcriptSearchOptions,
	);
	if (rules.length === 0) {
		persistEngineState(engine, cachePath, completedPostCompactChannel);
		return "";
	}

	const block = engine.formatStatic(rules);
	for (const rule of rules) {
		engine.markStaticInjected(rule);
	}
	persistEngineState(engine, cachePath, completedPostCompactChannel);
	return formatAdditionalContextOutput(eventName, block);
}
