import type { CodexRulesHookOptions } from "./codex-hook-options.js";
import { configFromEnvironment } from "./config.js";
import { formatAdditionalContextOutput } from "./hook-output.js";
import { completePostCompactRecovery, hydrateEngineState, persistEngineState } from "./persistent-cache.js";
import { withPostCompactBudget } from "./post-compact-budget.js";
import { createRulesEngine } from "./rules-engine-factory.js";
import { getSparkShellRuntimeAwareness, SPARKSHELL_AWARENESS_DEDUP_KEY } from "./sparkshell-awareness.js";
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
	const sparkshellAwareness = engine.state.staticDedup.has(SPARKSHELL_AWARENESS_DEDUP_KEY)
		? ""
		: getSparkShellRuntimeAwareness(options.env);
	if (rules.length === 0 && sparkshellAwareness.length === 0) {
		persistEngineState(engine, cachePath, completedPostCompactChannel);
		return "";
	}

	const block = engine.formatStatic(rules);
	for (const rule of rules) {
		engine.markStaticInjected(rule);
	}
	if (sparkshellAwareness.length > 0) {
		engine.state.staticDedup.add(SPARKSHELL_AWARENESS_DEDUP_KEY);
	}
	persistEngineState(engine, cachePath, completedPostCompactChannel);
	return formatAdditionalContextOutput(eventName, combineStaticContext(block, sparkshellAwareness));
}

function combineStaticContext(...blocks: readonly string[]): string {
	return blocks.filter((block) => block.trim().length > 0).join("\n\n");
}
