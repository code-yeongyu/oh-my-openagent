import { homedir } from "node:os";
import type { RuleFileReader, RuleInjectionProcessorDeps, RuleStatReader, ToolExecuteOutput, TranscriptHydrationHook } from "./injection-types";
import { createContentHash, isDuplicateByContentHash, isDuplicateByRealPath, shouldApplyRule } from "./matcher";
import type { FindRuleFilesOptions } from "./rule-file-finder";
import type { RuleScanCache } from "./rule-scan-cache";
import { saveInjectedRules } from "./storage";
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
export declare function createRuleInjectionProcessor(deps: CreateRuleInjectionProcessorDeps): {
    processFilePathForInjection: (filePath: string, sessionID: string, output: ToolExecuteOutput) => Promise<void>;
};
