import { shouldApplyRule } from "./matcher";
import { type MatchDecisionCache } from "./match-decision-cache";
export declare function getRuleMatchReason(input: {
    matchDecisionCache: MatchDecisionCache;
    isSingleFile: boolean | undefined;
    projectRoot: string | null;
    resolved: string;
    realPath: string;
    statFingerprint: string | null;
    metadata: Parameters<typeof shouldApplyRule>[0];
    shouldApplyRuleImpl: typeof shouldApplyRule;
}): string | null;
