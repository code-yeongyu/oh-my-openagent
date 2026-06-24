import { dirname, resolve } from "node:path";
import { pathBasesForTarget, toPosixPath } from "./engine-paths.js";
import type { CandidateDiscoveryCache, DynamicMatchCache, EngineDeps } from "./engine-types.js";
import type { matchRule } from "./matcher.js";
import { sortCandidates } from "./ordering.js";
import type { LoadedRule, MatchReason, RuleCandidate } from "./types.js";

const MAX_DYNAMIC_MATCH_CACHE_ENTRIES = 4096;

export function matchDynamicRuleCached(
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

export function findSortedCandidatesCached(
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

function candidateDiscoveryCacheKey(options: Parameters<EngineDeps["findCandidates"]>[0]): string {
	return [
		options.projectRoot ?? "",
		options.targetFile === null ? "" : dirname(resolve(options.targetFile)),
		...[...(options.disabledSources ?? [])].sort(),
	].join("\0");
}
