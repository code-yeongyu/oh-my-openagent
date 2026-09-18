export type MatchDecisionCache = Map<string, string | null>;
export declare function createMatchDecisionCache(): MatchDecisionCache;
export declare function getCachedMatchReason(cache: MatchDecisionCache, projectRoot: string | null, resolvedFilePath: string, realPath: string, statFingerprint: string | null): string | null | undefined;
export declare function setCachedMatchReason(cache: MatchDecisionCache, projectRoot: string | null, resolvedFilePath: string, realPath: string, statFingerprint: string | null, matchReason: string | null): void;
