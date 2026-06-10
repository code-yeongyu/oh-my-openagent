import type { CodexRulesHookOptions } from "./codex-hook-options.js";
import { configFromEnvironment } from "./config.js";
import { hasContextPressureMarker, transcriptHasContextPressureMarker } from "./context-pressure.js";
import { createHookDebugTimer } from "./debug-log.js";
import { fingerprintDynamicTargets } from "./dynamic-target-fingerprints.js";
import { withDynamicBudget } from "./event-budget.js";
import { formatAdditionalContextOutput } from "./hook-output.js";
import { displayPath, uniqueStrings } from "./path-utils.js";
import {
	claimPostCompactPending,
	clearSessionState,
	hasPostCompactPending,
	hydrateEngineState,
	isPostCompactRecoveryInProgress,
	markSessionCompacted,
	persistEngineState,
	sessionCachePath,
} from "./persistent-cache.js";
import { withPostCompactBudget } from "./post-compact-budget.js";
import { claimedPostCompactKind, shouldSkipPostCompactClaim } from "./post-compact-claim.js";
import { createRulesEngine } from "./rules-engine-factory.js";
import { runStaticInjection } from "./static-injection.js";
import { extractCodexToolPaths } from "./tool-paths.js";
import { filterRulesAlreadyInTranscript } from "./transcript-rule-filter.js";

export type { CodexRulesHookOptions } from "./codex-hook-options.js";

export type CodexSessionStartInput = {
	session_id: string;
	transcript_path: string | null;
	cwd: string;
	hook_event_name: "SessionStart";
	model: string;
	permission_mode: string;
	source: "startup" | "resume" | "clear" | "compact";
};

export type CodexUserPromptSubmitInput = {
	session_id: string;
	turn_id: string;
	transcript_path: string | null;
	cwd: string;
	hook_event_name: "UserPromptSubmit";
	model: string;
	permission_mode: string;
	prompt: string;
};

export type CodexPostToolUseInput = {
	session_id: string;
	turn_id: string;
	transcript_path: string | null;
	cwd: string;
	hook_event_name: "PostToolUse";
	model: string;
	permission_mode: string;
	tool_name: string;
	tool_input: unknown;
	tool_response: unknown;
	tool_use_id: string;
};

export type CodexPostCompactInput = {
	session_id: string;
	turn_id: string;
	transcript_path: string | null;
	cwd: string;
	hook_event_name: "PostCompact";
	model: string;
	trigger: "manual" | "auto";
};

export async function runSessionStartHook(
	input: CodexSessionStartInput,
	options: CodexRulesHookOptions = {},
): Promise<string> {
	const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
	if (input.source === "clear") {
		clearSessionState(cachePath);
	} else if (input.source !== "resume" && input.source !== "compact" && !hasPostCompactPending(cachePath)) {
		clearSessionState(cachePath);
	}
	const postCompactClaim = input.source === "clear" ? "not-pending" : claimPostCompactPending(cachePath, "static");
	const completedPostCompactKind =
		claimedPostCompactKind(postCompactClaim, "static") ??
		(input.source === "compact" && postCompactClaim === "not-pending" ? "static" : undefined);
	if (
		shouldSkipPostCompactClaim(
			postCompactClaim,
			input.source === "compact" && isPostCompactRecoveryInProgress(cachePath, "static"),
		)
	) {
		return "";
	}
	const transcriptPath = input.source === "clear" ? null : input.transcript_path;
	return runStaticInjection(
		input.cwd,
		transcriptPath,
		"SessionStart",
		cachePath,
		options,
		completedPostCompactKind,
		{ latestCompactedReplacementOnly: completedPostCompactKind !== undefined },
		input.model,
	);
}

export async function runPostCompactHook(
	input: CodexPostCompactInput,
	options: CodexRulesHookOptions = {},
): Promise<string> {
	markSessionCompacted(sessionCachePath(input.session_id, options.pluginDataRoot));
	return "";
}

export async function runUserPromptSubmitHook(
	input: CodexUserPromptSubmitInput,
	options: CodexRulesHookOptions = {},
): Promise<string> {
	if (hasContextPressureMarker(input.prompt)) {
		return "";
	}
	const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
	const postCompactClaim = claimPostCompactPending(cachePath, "static");
	if (postCompactClaim === "not-pending" && transcriptHasContextPressureMarker(input.transcript_path)) {
		return "";
	}
	const completedPostCompactKind = claimedPostCompactKind(postCompactClaim, "static");
	if (shouldSkipPostCompactClaim(postCompactClaim, isPostCompactRecoveryInProgress(cachePath, "static"))) {
		return "";
	}
	return runStaticInjection(
		input.cwd,
		input.transcript_path,
		"UserPromptSubmit",
		cachePath,
		options,
		completedPostCompactKind,
		{ latestCompactedReplacementOnly: completedPostCompactKind !== undefined },
		input.model,
	);
}

export async function runPostToolUseHook(
	input: CodexPostToolUseInput,
	options: CodexRulesHookOptions = {},
): Promise<string> {
	const debugTimer = createHookDebugTimer("PostToolUse");
	const config = configFromEnvironment(options.env);
	debugTimer.lap("config", { disabled: config.disabled, mode: config.mode });
	if (config.disabled || config.mode === "off" || config.mode === "static") {
		debugTimer.done({ outputBytes: 0, reason: "disabled" });
		return "";
	}

	const targetPaths = extractCodexToolPaths(input, input.cwd);
	debugTimer.lap("extract", {
		targets: targetPaths.length,
		uniqueTargets: uniqueStrings(targetPaths).length,
		tool: input.tool_name,
	});
	const firstTargetPath = targetPaths[0];
	if (firstTargetPath === undefined) {
		debugTimer.done({ outputBytes: 0, reason: "no-target" });
		return "";
	}

	const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
	const postCompactClaim = claimPostCompactPending(cachePath, "dynamic");
	if (postCompactClaim === "not-pending" && transcriptHasContextPressureMarker(input.transcript_path)) {
		debugTimer.done({ outputBytes: 0, reason: "context-pressure-transcript" });
		return "";
	}
	const completedPostCompactKind = claimedPostCompactKind(postCompactClaim, "dynamic");
	if (shouldSkipPostCompactClaim(postCompactClaim, isPostCompactRecoveryInProgress(cachePath, "dynamic"))) {
		debugTimer.done({ outputBytes: 0, reason: "post-compact-recovery-in-progress" });
		return "";
	}
	const dynamicConfig = withDynamicBudget(config);
	const engine = createRulesEngine(
		options,
		completedPostCompactKind !== undefined
			? withPostCompactBudget(dynamicConfig, { model: input.model, transcriptPath: input.transcript_path })
			: dynamicConfig,
	);
	hydrateEngineState(engine, cachePath);
	debugTimer.lap("hydrate", {
		dynamicDedupScopes: engine.state.dynamicDedup.size,
		dynamicTargetFingerprints: engine.state.dynamicTargetFingerprints.size,
		staticDedup: engine.state.staticDedup.size,
	});
	const dynamicTargetFingerprints = fingerprintDynamicTargets(input.cwd, targetPaths, config);
	debugTimer.lap("fingerprint", { fingerprints: dynamicTargetFingerprints.length });
	const pendingTargetFingerprints = dynamicTargetFingerprints.filter(
		(target) => engine.state.dynamicTargetFingerprints.get(target.cacheKey) !== target.fingerprint,
	);
	debugTimer.lap("pending", { pending: pendingTargetFingerprints.length });
	if (pendingTargetFingerprints.length === 0) {
		persistEngineState(engine, cachePath, completedPostCompactKind);
		debugTimer.lap("persist", { reason: "no-pending" });
		debugTimer.done({ outputBytes: 0, reason: "no-pending" });
		return "";
	}

	const loaded = engine.loadDynamicRules(
		input.cwd,
		pendingTargetFingerprints.map((target) => target.targetPath),
	);
	debugTimer.lap("load", { diagnostics: loaded.diagnostics.length, loadedRules: loaded.rules.length });
	const rules = filterRulesAlreadyInTranscript(
		loaded.rules.filter((rule) => !engine.isStaticInjected(rule) && !engine.isDynamicInjected(rule)),
		input.transcript_path,
		(rule) => {
			engine.markDynamicInjected(rule);
		},
		{ latestCompactedReplacementOnly: completedPostCompactKind !== undefined },
	);
	debugTimer.lap("filter", { rules: rules.length });
	for (const target of pendingTargetFingerprints) {
		engine.state.dynamicTargetFingerprints.set(target.cacheKey, target.fingerprint);
	}
	if (rules.length === 0) {
		persistEngineState(engine, cachePath, completedPostCompactKind);
		debugTimer.lap("persist", { reason: "no-rules" });
		debugTimer.done({ outputBytes: 0, reason: "no-rules" });
		return "";
	}

	const firstPendingTargetPath = pendingTargetFingerprints[0]?.targetPath ?? firstTargetPath;
	const block = engine.formatDynamic(rules, displayPath(input.cwd, firstPendingTargetPath));
	debugTimer.lap("format", { blockChars: block.length, rules: rules.length });
	for (const rule of rules) {
		engine.markDynamicInjected(rule);
	}
	persistEngineState(engine, cachePath, completedPostCompactKind);
	debugTimer.lap("persist", { reason: "emit" });
	const output = formatAdditionalContextOutput("PostToolUse", block);
	debugTimer.done({ outputBytes: Buffer.byteLength(output), reason: "emit" });
	return output;
}
