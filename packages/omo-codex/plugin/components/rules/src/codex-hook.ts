import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { configFromEnvironment } from "./config.js";
import { createHookDebugTimer } from "./debug-log.js";
import {
	clearSessionState,
	hasPostCompactPending,
	hydrateEngineState,
	isPostCompactPending,
	markSessionCompacted,
	persistEngineState,
	sessionCachePath,
} from "./persistent-cache.js";
import { SOURCE_PRIORITY } from "./rules/constants.js";
import { createEngine } from "./rules/engine.js";
import { createRuleDiscoveryCache, findRuleCandidates } from "./rules/finder.js";
import { hashContent } from "./rules/matcher.js";
import { sortCandidates } from "./rules/ordering.js";
import { findProjectRoot } from "./rules/project-root.js";
import type { LoadedRule, PiRulesConfig, RuleCandidate } from "./rules/types.js";
import { extractCodexToolPaths } from "./tool-paths.js";

type ContextInjectionHookEventName = "SessionStart" | "UserPromptSubmit" | "PostToolUse";

export type CodexSessionStartInput = {
	session_id: string;
	transcript_path: string | null;
	cwd: string;
	hook_event_name: "SessionStart";
	model: string;
	permission_mode: string;
	source: "startup" | "resume" | "clear";
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

export interface CodexRulesHookOptions {
	env?: NodeJS.ProcessEnv;
	pluginDataRoot?: string;
}

interface DynamicTargetFingerprint {
	targetPath: string;
	cacheKey: string;
	fingerprint: string;
}

export async function runSessionStartHook(
	input: CodexSessionStartInput,
	options: CodexRulesHookOptions = {},
): Promise<string> {
	const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
	if (input.source === "clear") {
		clearSessionState(cachePath);
	} else if (input.source !== "resume" && !hasPostCompactPending(cachePath)) {
		clearSessionState(cachePath);
	}
	const postCompactPending = input.source !== "clear" && isPostCompactPending(cachePath, "static");
	const transcriptPath = input.source === "clear" || postCompactPending ? null : input.transcript_path;
	return runStaticInjection(
		input.cwd,
		transcriptPath,
		"SessionStart",
		cachePath,
		options,
		postCompactPending ? "static" : undefined,
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
	const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
	const postCompactPending = isPostCompactPending(cachePath, "static");
	const transcriptPath = postCompactPending ? null : input.transcript_path;
	return runStaticInjection(
		input.cwd,
		transcriptPath,
		"UserPromptSubmit",
		cachePath,
		options,
		postCompactPending ? "static" : undefined,
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
	const postCompactPending = isPostCompactPending(cachePath, "dynamic");
	const transcriptPath = postCompactPending ? null : input.transcript_path;
	const engine = createRulesEngine(options);
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
		persistEngineState(engine, cachePath, postCompactPending ? "dynamic" : undefined);
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
		transcriptPath,
		(rule) => {
			engine.markDynamicInjected(rule);
		},
	);
	debugTimer.lap("filter", { rules: rules.length });
	for (const target of pendingTargetFingerprints) {
		engine.state.dynamicTargetFingerprints.set(target.cacheKey, target.fingerprint);
	}
	if (rules.length === 0) {
		persistEngineState(engine, cachePath, postCompactPending ? "dynamic" : undefined);
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
	persistEngineState(engine, cachePath, postCompactPending ? "dynamic" : undefined);
	debugTimer.lap("persist", { reason: "emit" });
	const output = formatAdditionalContextOutput("PostToolUse", block);
	debugTimer.done({ outputBytes: Buffer.byteLength(output), reason: "emit" });
	return output;
}

function runStaticInjection(
	cwd: string,
	transcriptPath: string | null,
	eventName: "SessionStart" | "UserPromptSubmit",
	cachePath: string,
	options: CodexRulesHookOptions,
	completedPostCompactChannel?: "static",
): string {
	const config = configFromEnvironment(options.env);
	if (config.disabled || config.mode === "off" || config.mode === "dynamic") {
		return "";
	}

	const engine = createRulesEngine(options);
	hydrateEngineState(engine, cachePath);
	engine.state.cwd = cwd;

	const loaded = engine.loadStaticRules(cwd);
	const rules = filterRulesAlreadyInTranscript(
		loaded.rules.filter((rule) => !engine.isStaticInjected(rule)),
		transcriptPath,
		(rule) => {
			engine.markStaticInjected(rule);
		},
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

function filterRulesAlreadyInTranscript(
	rules: ReadonlyArray<LoadedRule>,
	transcriptPath: string | null,
	markInjected: (rule: LoadedRule) => void,
): LoadedRule[] {
	if (rules.length === 0 || transcriptPath === null) {
		return [...rules];
	}

	const transcriptText = readTranscriptSearchText(transcriptPath);
	if (transcriptText === null) {
		return [...rules];
	}

	const pendingRules: LoadedRule[] = [];
	for (const rule of rules) {
		if (isRuleAlreadyInTranscript(rule, transcriptText)) {
			markInjected(rule);
			continue;
		}

		pendingRules.push(rule);
	}
	return pendingRules;
}

function isRuleAlreadyInTranscript(rule: LoadedRule, transcriptText: string): boolean {
	const bodyNeedle = rule.body.trim().slice(0, 2_000);
	if (bodyNeedle.length === 0 || !transcriptText.includes(bodyNeedle)) {
		return false;
	}

	const markers = [
		`Instructions from: ${rule.path}`,
		`Instructions from: ${rule.realPath}`,
		rule.relativePath.length === 0 ? null : rule.relativePath,
	].filter((marker): marker is string => marker !== null);
	return markers.some((marker) => transcriptText.includes(marker));
}

function readTranscriptSearchText(transcriptPath: string): string | null {
	try {
		const rawTranscript = readFileSync(transcriptPath, "utf8");
		return [rawTranscript, ...collectJsonLineStrings(rawTranscript)].join("\n");
	} catch {
		return null;
	}
}

function collectJsonLineStrings(rawTranscript: string): string[] {
	const values: string[] = [];
	for (const line of rawTranscript.split(/\r?\n/)) {
		if (line.trim().length === 0) {
			continue;
		}

		try {
			const parsed: unknown = JSON.parse(line);
			collectStrings(parsed, values);
		} catch {
			// Non-JSON transcript lines are still covered by the raw transcript text.
		}
	}
	return values;
}

function collectStrings(value: unknown, output: string[]): void {
	if (typeof value === "string") {
		output.push(value);
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectStrings(item, output);
		}
		return;
	}

	if (typeof value !== "object" || value === null) {
		return;
	}

	for (const item of Object.values(value)) {
		collectStrings(item, output);
	}
}

function createRulesEngine(options: CodexRulesHookOptions) {
	const config = configFromEnvironment(options.env);
	return createEngine(config, {
		findCandidates: findRuleCandidates,
		findProjectRoot,
		readFile: (path) => {
			try {
				return readFileSync(path, "utf8");
			} catch {
				return null;
			}
		},
	});
}

function fingerprintDynamicTargets(
	cwd: string,
	targetPaths: ReadonlyArray<string>,
	config: PiRulesConfig,
): DynamicTargetFingerprint[] {
	const disabledSources = disabledSourcesFor(config);
	const discoveryCache = createRuleDiscoveryCache();
	const cwdProjectRoot = findProjectRoot(cwd);
	const fingerprints: DynamicTargetFingerprint[] = [];

	for (const targetPath of uniqueStrings(targetPaths)) {
		const projectRoot =
			cwdProjectRoot !== null && isSameOrChildPath(targetPath, cwdProjectRoot)
				? cwdProjectRoot
				: findProjectRoot(targetPath);
		const findOptions: {
			projectRoot: string | null;
			targetFile: string;
			disabledSources?: ReadonlySet<string>;
			cache: ReturnType<typeof createRuleDiscoveryCache>;
		} = {
			projectRoot,
			targetFile: targetPath,
			cache: discoveryCache,
		};
		if (disabledSources !== undefined) {
			findOptions.disabledSources = disabledSources;
		}
		const candidates = findRuleCandidates(findOptions);
		const candidateFingerprint = sortCandidates(candidates).map(fingerprintCandidate).join("\u0001");
		const cacheKey = dynamicTargetCacheKey(targetPath);
		fingerprints.push({
			targetPath,
			cacheKey,
			fingerprint: hashContent(
				[
					"v1",
					config.enabledSources === "auto" ? "auto" : config.enabledSources.join(","),
					projectRoot ?? "",
					cacheKey,
					candidateFingerprint,
				].join("\u0000"),
			),
		});
	}

	return fingerprints;
}

function fingerprintCandidate(candidate: RuleCandidate): string {
	return [
		candidate.realPath,
		candidate.relativePath,
		candidate.source,
		candidate.isGlobal ? "global" : "project",
		candidate.isSingleFile ? "single" : "multi",
		String(candidate.distance),
		fileFingerprint(candidate.path),
	].join("\u0000");
}

function fileFingerprint(filePath: string): string {
	try {
		const stats = statSync(filePath, { bigint: true });
		return `${stats.mtimeNs}:${stats.ctimeNs}:${stats.size}`;
	} catch {
		return "missing";
	}
}

function disabledSourcesFor(config: PiRulesConfig): ReadonlySet<string> | undefined {
	if (config.enabledSources === "auto") {
		return undefined;
	}

	const enabledSources = new Set(config.enabledSources);
	return new Set([...SOURCE_PRIORITY.keys()].filter((source) => !enabledSources.has(source)));
}

function dynamicTargetCacheKey(targetPath: string): string {
	return toPosixPath(resolve(targetPath));
}

function isSameOrChildPath(childPath: string, parentPath: string): boolean {
	const childRelativePath = relative(parentPath, resolve(childPath));
	return childRelativePath === "" || (!childRelativePath.startsWith("..") && !isAbsolute(childRelativePath));
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
	const uniqueValues: string[] = [];
	const seenValues = new Set<string>();
	for (const value of values) {
		if (seenValues.has(value)) {
			continue;
		}

		seenValues.add(value);
		uniqueValues.push(value);
	}
	return uniqueValues;
}

function formatAdditionalContextOutput(eventName: ContextInjectionHookEventName, additionalContext: string): string {
	if (additionalContext.trim().length === 0) return "";
	return `${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: eventName,
			additionalContext,
		},
	})}\n`;
}

function displayPath(cwd: string, filePath: string): string {
	const rel = isAbsolute(filePath) ? relative(cwd, filePath) : filePath;
	// Normalize to POSIX separators so injected rule context renders the same
	// path string on Linux/macOS and Windows (Codex feeds this verbatim into
	// the model prompt, and the existing engine already emits POSIX paths).
	return toPosixPath(rel);
}

function toPosixPath(path: string): string {
	return path.replaceAll("\\", "/");
}
