import { shouldApplyRule } from "./matcher";
import {
	getCachedMatchReason,
	setCachedMatchReason,
	type MatchDecisionCache,
} from "./match-decision-cache";

export function getRuleMatchReason(input: {
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
