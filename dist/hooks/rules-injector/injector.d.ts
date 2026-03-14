import type { SessionInjectedRulesCache } from "./cache";
type ToolExecuteOutput = {
    title: string;
    output: string;
    metadata: unknown;
};
type DynamicTruncator = {
    truncate: (sessionID: string, content: string) => Promise<{
        result: string;
        truncated: boolean;
    }>;
};
export declare function createRuleInjectionProcessor(deps: {
    workspaceDirectory: string;
    truncator: DynamicTruncator;
    getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
}): {
    processFilePathForInjection: (filePath: string, sessionID: string, output: ToolExecuteOutput) => Promise<void>;
};
export {};
