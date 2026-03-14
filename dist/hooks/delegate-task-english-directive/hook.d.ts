export declare const TARGET_SUBAGENT_TYPES: readonly ["explore", "librarian", "oracle", "plan"];
export declare const ENGLISH_DIRECTIVE = "**YOU MUST ALWAYS THINK, REASON, AND RESPOND IN ENGLISH REGARDLESS OF THE USER'S QUERY LANGUAGE.**";
export declare function createDelegateTaskEnglishDirectiveHook(): {
    "tool.execute.before": (input: {
        tool: string;
        sessionID: string;
        callID: string;
        input: Record<string, unknown>;
    }, _output: {
        title: string;
        output: string;
        metadata: unknown;
    }) => Promise<void>;
};
