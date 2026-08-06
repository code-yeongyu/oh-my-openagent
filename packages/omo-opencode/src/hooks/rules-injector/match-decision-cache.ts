export type MatchDecisionCache = Map<string, string | null>;

const MAX_MATCH_DECISION_CACHE_ENTRIES = 4096;

export function createMatchDecisionCache(): MatchDecisionCache {
	return new Map();
}

export function getCachedMatchReason(
	cache: MatchDecisionCache,
	projectRoot: string | null,
	resolvedFilePath: string,
	realPath: string,
	statFingerprint: string | null,
): string | null | undefined {
	const cacheKey = matchDecisionCacheKey(
		projectRoot,
		resolvedFilePath,
		realPath,
		statFingerprint,
	);
	if (cacheKey === null || !cache.has(cacheKey)) return undefined;

	const cached = cache.get(cacheKey) ?? null;
	cache.delete(cacheKey);
	cache.set(cacheKey, cached);
	return cached;
}

export function setCachedMatchReason(
	cache: MatchDecisionCache,
	projectRoot: string | null,
	resolvedFilePath: string,
	realPath: string,
	statFingerprint: string | null,
	matchReason: string | null,
): void {
	const cacheKey = matchDecisionCacheKey(
		projectRoot,
		resolvedFilePath,
		realPath,
		statFingerprint,
	);
	if (cacheKey === null) return;

	if (!cache.has(cacheKey) && cache.size >= MAX_MATCH_DECISION_CACHE_ENTRIES) {
		const oldestCacheKey = cache.keys().next().value;
		if (oldestCacheKey !== undefined) {
			cache.delete(oldestCacheKey);
		}
	}
	cache.set(cacheKey, matchReason);
}

function matchDecisionCacheKey(
	projectRoot: string | null,
	resolvedFilePath: string,
	realPath: string,
	statFingerprint: string | null,
): string | null {
	if (statFingerprint === null) return null;
	return [projectRoot ?? "", resolvedFilePath, realPath, statFingerprint].join(
		"\0",
	);
}
