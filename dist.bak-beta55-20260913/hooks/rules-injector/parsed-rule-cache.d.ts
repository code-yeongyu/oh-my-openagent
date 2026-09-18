import type { ParsedRule, RuleFileReader, RuleStatReader } from "./injection-types";
export interface ParsedRuleCacheStats {
    entries: number;
    bodyBytes: number;
}
export declare function clearParsedRuleCache(): void;
export declare function getParsedRuleCacheStats(): ParsedRuleCacheStats;
export declare function createParsedRuleReader(options?: {
    readFileSync?: RuleFileReader;
    statSync?: RuleStatReader;
}): (filePath: string, realPath: string) => ParsedRule;
