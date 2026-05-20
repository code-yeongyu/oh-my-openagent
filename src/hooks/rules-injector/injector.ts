import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { findProjectRoot, findRuleFiles } from "./finder";
import type { FindRuleFilesOptions } from "./rule-file-finder";
import {
	createContentHash,
	isDuplicateByContentHash,
	isDuplicateByRealPath,
	shouldApplyRule,
} from "./matcher";
import { parseRuleFrontmatter } from "./parser";
import { saveInjectedRules } from "./storage";
import type { SessionInjectedRulesCache } from "./cache";
import type { RuleScanCache } from "./rule-scan-cache";
import type { RuleMetadata } from "./types";

type ToolExecuteOutput = {
	title: string;
	output: string;
	metadata: unknown;
};

type RuleToInject = {
	relativePath: string;
	matchReason: string;
	content: string;
	distance: number;
};

type DynamicTruncator = {
	truncate: (
		sessionID: string,
		content: string,
	) => Promise<{ result: string; truncated: boolean }>;
};

type RuleFileReader = (path: string, encoding: "utf-8") => string;

interface ParsedRuleEntry {
	mtimeMs: number;
	size: number;
	metadata: RuleMetadata;
	body: string;
}

type ParsedRule = {
	metadata: RuleMetadata;
	body: string;
	statFingerprint: string | null;
};

type MatchDecisionCache = Map<string, string | null>;

export interface ParsedRuleCacheStats {
	entries: number;
	bodyBytes: number;
}

const MAX_PARSED_RULE_CACHE_ENTRIES = 256;
const MAX_PARSED_RULE_CACHE_BODY_BYTES = 64 * 1024;
const MAX_MATCH_DECISION_CACHE_ENTRIES = 4096;
const parsedRuleCache = new Map<string, ParsedRuleEntry>();

export function clearParsedRuleCache(): void {
	parsedRuleCache.clear();
}

export function getParsedRuleCacheStats(): ParsedRuleCacheStats {
	let bodyBytes = 0;
	for (const entry of parsedRuleCache.values()) {
		bodyBytes += Buffer.byteLength(entry.body, "utf8");
	}
	return { entries: parsedRuleCache.size, bodyBytes };
}

function setParsedRuleCacheEntry(
	realPath: string,
	entry: ParsedRuleEntry,
): void {
	if (Buffer.byteLength(entry.body, "utf8") > MAX_PARSED_RULE_CACHE_BODY_BYTES)
		return;
	if (parsedRuleCache.size >= MAX_PARSED_RULE_CACHE_ENTRIES) {
		const oldestRealPath = parsedRuleCache.keys().next().value;
		if (oldestRealPath !== undefined) {
			parsedRuleCache.delete(oldestRealPath);
		}
	}
	parsedRuleCache.set(realPath, entry);
}

function resolveFilePath(
	workspaceDirectory: string,
	path: string,
): string | null {
	if (!path) return null;
	if (path.startsWith("/")) return path;
	return resolve(workspaceDirectory, path);
}

export function createRuleInjectionProcessor(deps: {
	workspaceDirectory: string;
	truncator: DynamicTruncator;
	getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
	getSessionRuleScanCache?: (sessionID: string) => RuleScanCache;
	ruleFinderOptions?: FindRuleFilesOptions;
	readFileSync?: RuleFileReader;
	statSync?: typeof statSync;
	homedir?: typeof homedir;
	shouldApplyRule?: typeof shouldApplyRule;
	isDuplicateByRealPath?: typeof isDuplicateByRealPath;
	createContentHash?: typeof createContentHash;
	isDuplicateByContentHash?: typeof isDuplicateByContentHash;
	saveInjectedRules?: typeof saveInjectedRules;
}): {
	processFilePathForInjection: (
		filePath: string,
		sessionID: string,
		output: ToolExecuteOutput,
	) => Promise<void>;
} {
	const {
		workspaceDirectory,
		truncator,
		getSessionCache,
		getSessionRuleScanCache,
		ruleFinderOptions,
		readFileSync: readRuleFileSync = readFileSync,
		statSync: statRuleSync = statSync,
		homedir: getHomeDir = homedir,
		shouldApplyRule: shouldApplyRuleImpl = shouldApplyRule,
		isDuplicateByRealPath: isDuplicateByRealPathImpl = isDuplicateByRealPath,
		createContentHash: createContentHashImpl = createContentHash,
		isDuplicateByContentHash:
			isDuplicateByContentHashImpl = isDuplicateByContentHash,
		saveInjectedRules: saveInjectedRulesImpl = saveInjectedRules,
	} = deps;

	const matchDecisionCache: MatchDecisionCache = new Map();
	const finderOptions: FindRuleFilesOptions = ruleFinderOptions
		? { ...ruleFinderOptions, workspaceDirectory }
		: { workspaceDirectory };

	function getParsedRule(filePath: string, realPath: string): ParsedRule {
		try {
			const stat = statRuleSync(filePath);
			const statFingerprint = `${stat.mtimeMs}:${stat.size}`;
			const cached = parsedRuleCache.get(realPath);

			if (
				cached &&
				cached.mtimeMs === stat.mtimeMs &&
				cached.size === stat.size
			) {
				return {
					metadata: cached.metadata,
					body: cached.body,
					statFingerprint,
				};
			}

			const rawContent = readRuleFileSync(filePath, "utf-8");
			const { metadata, body } = parseRuleFrontmatter(rawContent);
			setParsedRuleCacheEntry(realPath, {
				mtimeMs: stat.mtimeMs,
				size: stat.size,
				metadata,
				body,
			});
			return { metadata, body, statFingerprint };
		} catch {
			const rawContent = readRuleFileSync(filePath, "utf-8");
			const { metadata, body } = parseRuleFrontmatter(rawContent);
			return { metadata, body, statFingerprint: null };
		}
	}

	async function processFilePathForInjection(
		filePath: string,
		sessionID: string,
		output: ToolExecuteOutput,
	): Promise<void> {
		const resolved = resolveFilePath(workspaceDirectory, filePath);
		if (!resolved) return;

		const projectRoot = findProjectRoot(resolved);
		const cache = getSessionCache(sessionID);
		const ruleScanCache = getSessionRuleScanCache?.(sessionID);
		const home = getHomeDir();

		const ruleFileCandidates = findRuleFiles(
			projectRoot,
			home,
			resolved,
			finderOptions,
			ruleScanCache,
		);
		const toInject: RuleToInject[] = [];
		let dirty = false;

		for (const candidate of ruleFileCandidates) {
			if (isDuplicateByRealPathImpl(candidate.realPath, cache.realPaths))
				continue;

			try {
				const { metadata, body, statFingerprint } = getParsedRule(
					candidate.path,
					candidate.realPath,
				);

				let matchReason: string;
				if (candidate.isSingleFile) {
					matchReason = "copilot-instructions (always apply)";
				} else {
					const cachedMatchReason = getCachedMatchReason(
						matchDecisionCache,
						projectRoot,
						resolved,
						candidate.realPath,
						statFingerprint,
					);
					if (cachedMatchReason !== undefined) {
						if (cachedMatchReason === null) continue;
						matchReason = cachedMatchReason;
					} else {
						const matchResult = shouldApplyRuleImpl(
							metadata,
							resolved,
							projectRoot,
						);
						if (!matchResult.applies) {
							setCachedMatchReason(
								matchDecisionCache,
								projectRoot,
								resolved,
								candidate.realPath,
								statFingerprint,
								null,
							);
							continue;
						}
						matchReason = matchResult.reason ?? "matched";
						setCachedMatchReason(
							matchDecisionCache,
							projectRoot,
							resolved,
							candidate.realPath,
							statFingerprint,
							matchReason,
						);
					}
				}

				const contentHash = createContentHashImpl(body);
				if (isDuplicateByContentHashImpl(contentHash, cache.contentHashes))
					continue;

				const relativePath = projectRoot
					? relative(projectRoot, candidate.path)
					: candidate.path;

				toInject.push({
					relativePath,
					matchReason,
					content: body,
					distance: candidate.distance,
				});

				cache.realPaths.add(candidate.realPath);
				cache.contentHashes.add(contentHash);
				dirty = true;
			} catch {}
		}

		if (toInject.length === 0) return;

		toInject.sort((a, b) => a.distance - b.distance);

		for (const rule of toInject) {
			const { result, truncated } = await truncator.truncate(
				sessionID,
				rule.content,
			);
			const truncationNotice = truncated
				? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${rule.relativePath}]`
				: "";
			output.output += `\n\n[Rule: ${rule.relativePath}]\n[Match: ${rule.matchReason}]\n${result}${truncationNotice}`;
		}

		if (dirty) {
			saveInjectedRulesImpl(sessionID, cache);
		}
	}

	return { processFilePathForInjection };
}

function getCachedMatchReason(
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

function setCachedMatchReason(
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

	if (cache.size >= MAX_MATCH_DECISION_CACHE_ENTRIES) {
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
