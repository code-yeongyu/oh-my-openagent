import { existsSync } from "node:fs";

import type { CodexRulesHookOptions } from "./codex-hook-options.js";
import { configFromEnvironment } from "./config.js";
import { withPromptBudget } from "./event-budget.js";
import { formatAdditionalContextOutput } from "./hook-output.js";
import { completePostCompactRecovery, hydrateEngineState, persistEngineState } from "./persistent-cache.js";
import { withPostCompactBudget } from "./post-compact-budget.js";
import { buildPostCompactReadDirective } from "./post-compact-directive.js";
import type { Engine } from "@oh-my-opencode/rules-engine/engine";
import { isNeverTruncatedRule } from "@oh-my-opencode/rules-engine/engine";
import type { LoadedRule, PiRulesConfig } from "@oh-my-opencode/rules-engine/engine";
import { createRulesEngine } from "./rules-engine-factory.js";
import { getSparkShellRuntimeAwareness, SPARKSHELL_AWARENESS_DEDUP_KEY } from "./sparkshell-awareness.js";
import { filterRulesAlreadyInTranscript, filterRulesNotInTranscriptText } from "./transcript-rule-filter.js";
import type { TranscriptSearchOptions } from "./transcript-search.js";
import { readTranscriptSearchText } from "./transcript-search.js";

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

	if (completedPostCompactChannel !== undefined) {
		return runPostCompactRecovery({
			cwd,
			transcriptPath,
			eventName,
			cachePath,
			options,
			channel: completedPostCompactChannel,
			model: model ?? "",
			config,
		});
	}

	const effectiveConfig = eventName === "UserPromptSubmit" ? withPromptBudget(config) : config;
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
		persistEngineState(engine, cachePath);
		return "";
	}

	const block = engine.formatStatic(rules);
	for (const rule of rules) {
		engine.markStaticInjected(rule);
	}
	if (sparkshellAwareness.length > 0) {
		engine.state.staticDedup.add(SPARKSHELL_AWARENESS_DEDUP_KEY);
	}
	persistEngineState(engine, cachePath);
	return formatAdditionalContextOutput(eventName, combineStaticContext(block, sparkshellAwareness));
}

interface PostCompactRecoveryInput {
	cwd: string;
	transcriptPath: string | null;
	eventName: "SessionStart" | "UserPromptSubmit";
	cachePath: string;
	options: CodexRulesHookOptions;
	channel: "static";
	model: string;
	config: PiRulesConfig;
}

function runPostCompactRecovery(input: PostCompactRecoveryInput): string {
	const effectiveConfig = withPostCompactBudget(input.config, {
		model: input.model,
		transcriptPath: input.transcriptPath,
	});
	const engine = createRulesEngine(input.options, effectiveConfig);
	hydrateEngineState(engine, input.cachePath);
	engine.state.cwd = input.cwd;

	const loaded = engine.loadStaticRules(input.cwd);
	const transcriptText = readRecoveryTranscriptText(input.transcriptPath);
	const missingRules = filterRulesNotInTranscriptText(
		loaded.rules.filter((rule) => !engine.isStaticInjected(rule)),
		transcriptText,
		(rule) => {
			engine.markStaticInjected(rule);
		},
	);
	const dynamicRulePaths = recoverDynamicRulePaths(engine, transcriptText, loaded.rules);
	const sparkshellAwareness = engine.state.staticDedup.has(SPARKSHELL_AWARENESS_DEDUP_KEY)
		? ""
		: getSparkShellRuntimeAwareness(input.options.env);

	if (missingRules.length === 0 && dynamicRulePaths.length === 0 && sparkshellAwareness.length === 0) {
		persistEngineState(engine, input.cachePath, input.channel);
		return "";
	}

	const fullBodyRules = missingRules.filter((rule) => isNeverTruncatedRule(ruleDisplayPath(rule)));
	const listedRules = missingRules.filter((rule) => !isNeverTruncatedRule(ruleDisplayPath(rule)));
	const bodyBlock = fullBodyRules.length === 0 ? "" : engine.formatStatic(fullBodyRules);
	const directive = buildPostCompactReadDirective(
		[...listedRules.map((rule) => rule.path), ...dynamicRulePaths],
		effectiveConfig.maxResultChars,
	);
	for (const rule of missingRules) {
		engine.markStaticInjected(rule);
	}
	if (sparkshellAwareness.length > 0) {
		engine.state.staticDedup.add(SPARKSHELL_AWARENESS_DEDUP_KEY);
	}
	persistEngineState(engine, input.cachePath, input.channel);
	return formatAdditionalContextOutput(
		input.eventName,
		combineStaticContext(bodyBlock, directive, sparkshellAwareness),
	);
}

function readRecoveryTranscriptText(transcriptPath: string | null): string | null {
	if (transcriptPath === null) {
		return null;
	}
	return (
		readTranscriptSearchText(transcriptPath, { latestCompactedReplacementOnly: true }) ??
		readTranscriptSearchText(transcriptPath)
	);
}

function recoverDynamicRulePaths(
	engine: Engine,
	transcriptText: string | null,
	staticRules: ReadonlyArray<LoadedRule>,
): string[] {
	const staticRulePaths = new Set(staticRules.map((rule) => rule.realPath));
	const recoveredPaths = new Set<string>();
	for (const dedupKeys of engine.state.dynamicDedup.values()) {
		for (const dedupKey of dedupKeys) {
			const separatorIndex = dedupKey.lastIndexOf("::");
			if (separatorIndex <= 0) {
				continue;
			}
			const rulePath = dedupKey.slice(0, separatorIndex);
			if (staticRulePaths.has(rulePath)) {
				continue;
			}
			if (transcriptText !== null && transcriptText.includes(rulePath)) {
				continue;
			}
			if (!existsSync(rulePath)) {
				continue;
			}
			recoveredPaths.add(rulePath);
		}
	}
	return [...recoveredPaths].sort();
}

function ruleDisplayPath(rule: LoadedRule): string {
	return rule.relativePath.length > 0 ? rule.relativePath : rule.path;
}

function combineStaticContext(...blocks: readonly string[]): string {
	return blocks.filter((block) => block.trim().length > 0).join("\n\n");
}
