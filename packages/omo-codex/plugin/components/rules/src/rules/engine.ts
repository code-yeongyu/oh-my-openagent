import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
	clearSession,
	createSessionState,
	isDynamicInjected as isDynamicInjectedInState,
	isStaticInjected as isStaticInjectedInState,
	markDynamicInjected as markDynamicInjectedInState,
	markStaticInjected as markStaticInjectedInState,
} from "./cache.js";
import {
	DEFAULT_MAX_RESULT_CHARS,
	DEFAULT_MAX_RULE_CHARS,
	DEFAULT_POST_COMPACT_MAX_RESULT_CHARS,
	DEFAULT_POST_COMPACT_MAX_RULE_CHARS,
	PROJECT_SINGLE_FILES,
	SOURCE_PRIORITY,
} from "./constants.js";
import { createRuleDiscoveryCache, type RuleDiscoveryCache } from "./finder.js";
import { formatDynamicBlock, formatStaticBlock } from "./formatter.js";
import { hashContent, matchRule } from "./matcher.js";
import { sortCandidates } from "./ordering.js";
import { parseRule } from "./parser.js";
import type { LoadedRule, MatchReason, PiRulesConfig, RuleCandidate, RuleDiagnostic, SessionState } from "./types.js";

interface LoadedRuleContent {
	frontmatter: LoadedRule["frontmatter"];
	body: string;
	contentHash: string;
	diagnostic?: string;
}

type CandidateProjectMembership = Map<string, boolean>;
type CandidateDiscoveryCache = Map<string, RuleCandidate[]>;
type DynamicMatchCache = Map<string, MatchReason | null>;

const MAX_DYNAMIC_MATCH_CACHE_ENTRIES = 4096;

export interface EngineDeps {
	findCandidates: (options: {
		projectRoot: string | null;
		targetFile: string | null;
		homeDir?: string;
		disabledSources?: ReadonlySet<string>;
		skipUserHome?: boolean;
		cache?: RuleDiscoveryCache;
	}) => RuleCandidate[];
	readFile: (path: string) => string | null;
	findProjectRoot: (startPath: string) => string | null;
	matchRule?: typeof matchRule;
}

export interface Engine {
	state: SessionState;
	config: PiRulesConfig;
	loadStaticRules(cwd: string): { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] };
	loadDynamicRules(
		cwd: string,
		targetPaths: ReadonlyArray<string>,
	): { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] };
	formatStatic(rules: ReadonlyArray<LoadedRule>): string;
	formatDynamic(rules: ReadonlyArray<LoadedRule>, target: string): string;
	resetSession(cwd?: string): void;
	isStaticInjected(rule: LoadedRule): boolean;
	isDynamicInjected(rule: LoadedRule): boolean;
	markStaticInjected(rule: LoadedRule): boolean;
	markDynamicInjected(rule: LoadedRule): boolean;
}

const ROOT_SINGLE_FILE_SOURCES = new Set(PROJECT_SINGLE_FILES.filter((source) => !source.includes("/")));

export function defaultConfig(): PiRulesConfig {
	return {
		disabled: false,
		mode: "both",
		maxRuleChars: DEFAULT_MAX_RULE_CHARS,
		maxResultChars: DEFAULT_MAX_RESULT_CHARS,
		postCompactMaxRuleChars: DEFAULT_POST_COMPACT_MAX_RULE_CHARS,
		postCompactMaxResultChars: DEFAULT_POST_COMPACT_MAX_RESULT_CHARS,
		enabledSources: "auto",
	};
}

export function createEngine(config: PiRulesConfig, deps: EngineDeps): Engine {
	const state = createSessionState();
	const dynamicMatchCache: DynamicMatchCache = new Map();

	function loadStaticRules(cwd: string): { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] } {
		state.cwd = cwd;
		if (config.disabled || config.mode === "off" || config.mode === "dynamic") {
			return emptyLoadResult(state);
		}

		const projectRoot = deps.findProjectRoot(cwd);
		const findOptions: Parameters<EngineDeps["findCandidates"]>[0] = {
			projectRoot,
			targetFile: null,
		};
		const disabledSources = disabledSourcesFor(config);
		if (disabledSources !== undefined) {
			findOptions.disabledSources = disabledSources;
		}
		const candidates = deps.findCandidates(findOptions);
		const result = loadStaticCandidates(candidates, deps, projectRoot);
		storeLastLoad(state, result.rules, result.diagnostics);
		return result;
	}

	function loadDynamicRules(
		cwd: string,
		targetPaths: ReadonlyArray<string>,
	): { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] } {
		state.cwd = cwd;
		if (config.disabled || config.mode === "off" || config.mode === "static" || targetPaths.length === 0) {
			return emptyLoadResult(state);
		}

		const rules: LoadedRule[] = [];
		const diagnostics: RuleDiagnostic[] = [];
		const seenRules = new Set<string>();
		const loadedRuleContent = new Map<string, LoadedRuleContent | null>();
		const projectMembership = new Map<string, boolean>();
		const disabledSources = disabledSourcesFor(config);
		const discoveryCache = createRuleDiscoveryCache();
		const candidateDiscoveryCache: CandidateDiscoveryCache = new Map();
		const cwdProjectRoot = deps.findProjectRoot(cwd);

		for (const targetFile of uniqueStrings(targetPaths)) {
			const projectRoot =
				cwdProjectRoot !== null && isSameOrChildPath(targetFile, cwdProjectRoot)
					? cwdProjectRoot
					: deps.findProjectRoot(targetFile);
			const findOptions: Parameters<EngineDeps["findCandidates"]>[0] = {
				projectRoot,
				targetFile,
				cache: discoveryCache,
			};
			if (disabledSources !== undefined) {
				findOptions.disabledSources = disabledSources;
			}
			const candidates = findSortedCandidatesCached(candidateDiscoveryCache, deps.findCandidates, findOptions);

			for (const candidate of candidates) {
				const loadedRule = loadCandidate(
					candidate,
					deps,
					diagnostics,
					projectRoot,
					loadedRuleContent,
					projectMembership,
				);
				if (loadedRule === null) {
					continue;
				}

				const matchReason = matchDynamicRuleCached(
					dynamicMatchCache,
					projectRoot,
					targetFile,
					candidate,
					loadedRule,
					deps.matchRule ?? matchRule,
				);

				if (matchReason === null) {
					continue;
				}

				const dedupKey = ruleDedupKey(loadedRule);
				if (seenRules.has(dedupKey)) {
					continue;
				}

				seenRules.add(dedupKey);
				rules.push({ ...loadedRule, matchReason });
			}
		}

		const sortedRules = sortCandidates(rules);
		storeLastLoad(state, sortedRules, diagnostics);
		return { rules: sortedRules, diagnostics };
	}

	return {
		state,
		config,
		loadStaticRules,
		loadDynamicRules,
		formatStatic: (rules) =>
			formatStaticBlock(rules, { maxRuleChars: config.maxRuleChars, maxResultChars: config.maxResultChars }),
		formatDynamic: (rules, target) =>
			formatDynamicBlock(rules, target, {
				maxRuleChars: config.maxRuleChars,
				maxResultChars: config.maxResultChars,
			}),
		resetSession: (cwd) => {
			clearSession(state);
			dynamicMatchCache.clear();
			if (cwd !== undefined) {
				state.cwd = cwd;
			}
		},
		isStaticInjected: (rule) => isStaticInjectedInState(state, rule),
		isDynamicInjected: (rule) => isDynamicInjectedInState(state, rule),
		markStaticInjected: (rule) => markStaticInjectedInState(state, rule),
		markDynamicInjected: (rule) => markDynamicInjectedInState(state, rule),
	};
}

function matchDynamicRuleCached(
	cache: DynamicMatchCache,
	projectRoot: string | null,
	targetFile: string,
	candidate: RuleCandidate,
	loadedRule: LoadedRule,
	matchRuleImpl: typeof matchRule,
): MatchReason | null {
	const cacheKey = dynamicMatchCacheKey(projectRoot, targetFile, candidate, loadedRule.contentHash);
	if (cache.has(cacheKey)) {
		const cachedReason = cache.get(cacheKey) ?? null;
		cache.delete(cacheKey);
		cache.set(cacheKey, cachedReason);
		return cachedReason;
	}

	const matchResult = matchRuleImpl({
		frontmatter: loadedRule.frontmatter,
		isSingleFile: candidate.isSingleFile,
		pathBases: pathBasesForTarget(projectRoot, targetFile, candidate),
	});
	const reason = matchResult.matched ? matchResult.reason : null;
	setDynamicMatchCacheEntry(cache, cacheKey, reason);
	return reason;
}

function setDynamicMatchCacheEntry(cache: DynamicMatchCache, cacheKey: string, reason: MatchReason | null): void {
	if (cache.size >= MAX_DYNAMIC_MATCH_CACHE_ENTRIES) {
		const oldestCacheKey = cache.keys().next().value;
		if (oldestCacheKey !== undefined) {
			cache.delete(oldestCacheKey);
		}
	}
	cache.set(cacheKey, reason);
}

function dynamicMatchCacheKey(
	projectRoot: string | null,
	targetFile: string,
	candidate: RuleCandidate,
	contentHash: string,
): string {
	return [
		projectRoot ?? "",
		toPosixPath(resolve(targetFile)),
		candidate.realPath,
		candidate.relativePath,
		candidate.source,
		candidate.isGlobal ? "global" : "project",
		candidate.isSingleFile ? "single" : "multi",
		String(candidate.distance),
		contentHash,
	].join("\0");
}

function loadStaticCandidates(candidates: ReadonlyArray<RuleCandidate>, deps: EngineDeps, projectRoot: string | null) {
	const rules: LoadedRule[] = [];
	const diagnostics: RuleDiagnostic[] = [];
	let rootSingleFileSelected = false;

	for (const candidate of sortCandidates(candidates)) {
		if (isDedupedRootSingleFile(candidate, rootSingleFileSelected)) {
			continue;
		}

		const loadedRule = loadCandidate(candidate, deps, diagnostics, projectRoot);
		if (loadedRule === null) {
			continue;
		}

		const matchReason = staticMatchReason(loadedRule);
		if (matchReason === null) {
			continue;
		}

		if (isRootSingleFile(candidate)) {
			rootSingleFileSelected = true;
		}

		rules.push({ ...loadedRule, matchReason });
	}

	return { rules: sortCandidates(rules), diagnostics };
}

function loadCandidate(
	candidate: RuleCandidate,
	deps: EngineDeps,
	diagnostics: RuleDiagnostic[],
	projectRoot: string | null,
	loadedRuleContent?: Map<string, LoadedRuleContent | null>,
	projectMembership?: CandidateProjectMembership,
): (LoadedRule & { matchReason: MatchReason }) | null {
	if (!isCandidateWithinProjectCached(candidate, projectRoot, projectMembership)) {
		diagnostics.push({
			severity: "warning",
			source: candidate.path,
			message: "Rule file resolves outside project root",
		});
		return null;
	}

	const cachedContent = loadedRuleContent?.get(candidate.realPath);
	if (cachedContent !== undefined) {
		return loadedRuleFromContent(candidate, cachedContent, diagnostics);
	}

	const content = deps.readFile(candidate.path);
	if (content === null) {
		loadedRuleContent?.set(candidate.realPath, null);
		diagnostics.push({ severity: "warning", source: candidate.path, message: "Unable to read rule file" });
		return null;
	}

	const parsed = parseRule(content);
	const loadedContent = {
		frontmatter: parsed.frontmatter,
		body: parsed.body,
		contentHash: hashContent(content),
		...(parsed.diagnostic === undefined ? {} : { diagnostic: parsed.diagnostic }),
	} satisfies LoadedRuleContent;
	loadedRuleContent?.set(candidate.realPath, loadedContent);
	return loadedRuleFromContent(candidate, loadedContent, diagnostics);
}

function loadedRuleFromContent(
	candidate: RuleCandidate,
	content: LoadedRuleContent | null,
	diagnostics: RuleDiagnostic[],
): (LoadedRule & { matchReason: MatchReason }) | null {
	if (content === null) {
		diagnostics.push({ severity: "warning", source: candidate.path, message: "Unable to read rule file" });
		return null;
	}

	if (content.diagnostic !== undefined) {
		diagnostics.push({ severity: "warning", source: candidate.path, message: content.diagnostic });
	}

	return {
		...candidate,
		frontmatter: content.frontmatter,
		body: content.body,
		contentHash: content.contentHash,
		matchReason: { kind: "no-match" },
	};
}

function ruleDedupKey(rule: LoadedRule): string {
	return `${rule.realPath}::${rule.contentHash}`;
}

function isCandidateWithinProject(candidate: RuleCandidate, projectRoot: string | null): boolean {
	if (candidate.isGlobal) {
		return true;
	}

	if (projectRoot === null) {
		return false;
	}

	const relativeRealPath = relative(realPathOrResolved(projectRoot), realPathOrResolved(candidate.realPath));
	return relativeRealPath === "" || (!relativeRealPath.startsWith("..") && !isAbsolute(relativeRealPath));
}

function isCandidateWithinProjectCached(
	candidate: RuleCandidate,
	projectRoot: string | null,
	projectMembership: CandidateProjectMembership | undefined,
): boolean {
	if (projectMembership === undefined) {
		return isCandidateWithinProject(candidate, projectRoot);
	}

	const cacheKey = `${projectRoot ?? ""}\0${candidate.realPath}`;
	const cached = projectMembership.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const isWithinProject = isCandidateWithinProject(candidate, projectRoot);
	projectMembership.set(cacheKey, isWithinProject);
	return isWithinProject;
}

function realPathOrResolved(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}

function findSortedCandidatesCached(
	cache: CandidateDiscoveryCache,
	findCandidates: EngineDeps["findCandidates"],
	options: Parameters<EngineDeps["findCandidates"]>[0],
): RuleCandidate[] {
	const cacheKey = candidateDiscoveryCacheKey(options);
	const cached = cache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const candidates = sortCandidates(findCandidates(options));
	cache.set(cacheKey, candidates);
	return candidates;
}

function candidateDiscoveryCacheKey(options: Parameters<EngineDeps["findCandidates"]>[0]): string {
	return [
		options.projectRoot ?? "",
		options.targetFile === null ? "" : dirname(resolve(options.targetFile)),
		...[...(options.disabledSources ?? [])].sort(),
	].join("\0");
}

function isSameOrChildPath(childPath: string, parentPath: string): boolean {
	const childRelativePath = relative(parentPath, resolve(childPath));
	return childRelativePath === "" || (!childRelativePath.startsWith("..") && !isAbsolute(childRelativePath));
}

function staticMatchReason(rule: LoadedRule): MatchReason | null {
	if (rule.frontmatter.alwaysApply === true) {
		return "alwaysApply";
	}

	if (rule.isSingleFile) {
		return "single-file";
	}

	return null;
}

function disabledSourcesFor(config: PiRulesConfig): ReadonlySet<string> | undefined {
	if (config.enabledSources === "auto") {
		return undefined;
	}

	const enabledSources = new Set(config.enabledSources);
	return new Set([...SOURCE_PRIORITY.keys()].filter((source) => !enabledSources.has(source)));
}

function isDedupedRootSingleFile(candidate: RuleCandidate, rootSingleFileSelected: boolean): boolean {
	return rootSingleFileSelected && isRootSingleFile(candidate);
}

function isRootSingleFile(candidate: RuleCandidate): boolean {
	return candidate.distance === 0 && candidate.isSingleFile && ROOT_SINGLE_FILE_SOURCES.has(candidate.source);
}

function pathBasesForTarget(
	projectRoot: string | null,
	targetFile: string,
	candidate: RuleCandidate,
): { projectRelative: string; scopeRelative?: string; basename: string } {
	const targetBasename = basename(targetFile);
	if (projectRoot === null) {
		return { projectRelative: targetBasename, basename: targetBasename };
	}

	const projectRelative = toPosixPath(relative(projectRoot, targetFile));
	const scopeDirectory = scopeDirectoryForCandidate(projectRoot, candidate);
	if (scopeDirectory === null) {
		return { projectRelative, basename: targetBasename };
	}

	return {
		projectRelative,
		scopeRelative: toPosixPath(relative(scopeDirectory, targetFile)),
		basename: targetBasename,
	};
}

function scopeDirectoryForCandidate(projectRoot: string, candidate: RuleCandidate): string | null {
	if (candidate.isGlobal) {
		return null;
	}

	if (candidate.isSingleFile) {
		return dirname(candidate.path);
	}

	const sourceIndex = candidate.relativePath.indexOf(candidate.source);
	if (sourceIndex === -1) {
		return projectRoot;
	}

	const scopeRelativeDirectory = candidate.relativePath.slice(0, sourceIndex).replace(/\/$/, "");
	return scopeRelativeDirectory.length === 0 ? projectRoot : join(projectRoot, scopeRelativeDirectory);
}

function toPosixPath(path: string): string {
	return path.replaceAll("\\", "/");
}

function storeLastLoad(
	state: SessionState,
	rules: ReadonlyArray<LoadedRule>,
	diagnostics: ReadonlyArray<RuleDiagnostic>,
): void {
	state.loadedRules.length = 0;
	state.loadedRules.push(...rules);
	state.diagnostics.length = 0;
	state.diagnostics.push(...diagnostics);
}

function emptyLoadResult(state: SessionState): { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] } {
	storeLastLoad(state, [], []);
	return { rules: [], diagnostics: [] };
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
