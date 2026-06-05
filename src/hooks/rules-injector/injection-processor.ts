import { homedir } from "node:os";
import { relative } from "node:path";
import { findProjectRoot, findRuleFiles } from "./finder";
import { appendInjectedRulesToOutput } from "./injection-output";
import type {
	RuleFileReader,
	RuleInjectionProcessorDeps,
	RuleStatReader,
	RuleToInject,
	ToolExecuteOutput,
	TranscriptHydrationHook,
} from "./injection-types";
import {
	createContentHash,
	isDuplicateByContentHash,
	isDuplicateByRealPath,
	shouldApplyRule,
} from "./matcher";
import {
	createMatchDecisionCache,
	getCachedMatchReason,
	setCachedMatchReason,
	type MatchDecisionCache,
} from "./match-decision-cache";
import { createParsedRuleReader } from "./parsed-rule-cache";
import { resolveFilePath } from "./path-resolution";
import type { FindRuleFilesOptions } from "./rule-file-finder";
import type { RuleScanCache } from "./rule-scan-cache";
import { saveInjectedRules } from "./storage";

const EMPTY_TRANSCRIPT_SET: ReadonlySet<string> = new Set();

export type CreateRuleInjectionProcessorDeps = RuleInjectionProcessorDeps & {
	getSessionRuleScanCache?: (sessionID: string) => RuleScanCache;
	ruleFinderOptions?: FindRuleFilesOptions;
	readFileSync?: RuleFileReader;
	statSync?: RuleStatReader;
	homedir?: typeof homedir;
	shouldApplyRule?: typeof shouldApplyRule;
	isDuplicateByRealPath?: typeof isDuplicateByRealPath;
	createContentHash?: typeof createContentHash;
	isDuplicateByContentHash?: typeof isDuplicateByContentHash;
	saveInjectedRules?: typeof saveInjectedRules;
	transcriptHydration?: TranscriptHydrationHook;
};

export function createRuleInjectionProcessor(
	deps: CreateRuleInjectionProcessorDeps,
): {
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
		homedir: getHomeDir = homedir,
		shouldApplyRule: shouldApplyRuleImpl = shouldApplyRule,
		isDuplicateByRealPath: isDuplicateByRealPathImpl = isDuplicateByRealPath,
		createContentHash: createContentHashImpl = createContentHash,
		isDuplicateByContentHash:
			isDuplicateByContentHashImpl = isDuplicateByContentHash,
		saveInjectedRules: saveInjectedRulesImpl = saveInjectedRules,
		transcriptHydration,
	} = deps;

	const getParsedRule = createParsedRuleReader({
		readFileSync: deps.readFileSync,
		statSync: deps.statSync,
	});
	const matchDecisionCache = createMatchDecisionCache();
	const finderOptions: FindRuleFilesOptions = ruleFinderOptions
		? { ...ruleFinderOptions, workspaceDirectory }
		: { workspaceDirectory };

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

		const transcriptRelativePaths = transcriptHydration
			? await transcriptHydration.hydrateSession(sessionID)
			: EMPTY_TRANSCRIPT_SET;

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
				const matchReason = getRuleMatchReason({
					matchDecisionCache,
					isSingleFile: candidate.isSingleFile,
					projectRoot,
					resolved,
					realPath: candidate.realPath,
					statFingerprint,
					metadata,
					shouldApplyRuleImpl,
				});
				if (matchReason === null) continue;

				const contentHash = createContentHashImpl(body);
				if (isDuplicateByContentHashImpl(contentHash, cache.contentHashes))
					continue;

				const relativePath = projectRoot
					? relative(projectRoot, candidate.path)
					: candidate.path;

				if (transcriptRelativePaths.has(relativePath)) {
					cache.realPaths.add(candidate.realPath);
					cache.contentHashes.add(contentHash);
					dirty = true;
					continue;
				}

				toInject.push({
					relativePath,
					matchReason,
					content: body,
					distance: candidate.distance,
				});

				cache.realPaths.add(candidate.realPath);
				cache.contentHashes.add(contentHash);
				dirty = true;
			} catch {
				continue;
			}
		}

		if (toInject.length === 0) return;

		await appendInjectedRulesToOutput(output, toInject, sessionID, truncator);

		if (dirty) {
			saveInjectedRulesImpl(sessionID, cache);
		}
	}

	return { processFilePathForInjection };
}

function getRuleMatchReason(input: {
	matchDecisionCache: MatchDecisionCache;
	isSingleFile: boolean | undefined;
	projectRoot: string | null;
	resolved: string;
	realPath: string;
	statFingerprint: string | null;
	metadata: Parameters<typeof shouldApplyRule>[0];
	shouldApplyRuleImpl: typeof shouldApplyRule;
}): string | null {
	if (input.isSingleFile) {
		return "copilot-instructions (always apply)";
	}

	const cachedMatchReason = getCachedMatchReason(
		input.matchDecisionCache,
		input.projectRoot,
		input.resolved,
		input.realPath,
		input.statFingerprint,
	);
	if (cachedMatchReason !== undefined) {
		return cachedMatchReason;
	}

	const matchResult = input.shouldApplyRuleImpl(
		input.metadata,
		input.resolved,
		input.projectRoot,
	);
	if (!matchResult.applies) {
		setCachedMatchReason(
			input.matchDecisionCache,
			input.projectRoot,
			input.resolved,
			input.realPath,
			input.statFingerprint,
			null,
		);
		return null;
	}

	const matchReason = matchResult.reason ?? "matched";
	setCachedMatchReason(
		input.matchDecisionCache,
		input.projectRoot,
		input.resolved,
		input.realPath,
		input.statFingerprint,
		matchReason,
	);
	return matchReason;
}
