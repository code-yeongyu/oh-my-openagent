type ToolExecuteInput = {
    tool: string;
    sessionID: string;
    callID: string;
};
type ToolBeforeOutput = {
    args: Record<string, unknown>;
};
type ToolAfterOutput = {
    title: string;
    output: string;
    metadata: unknown;
};
export declare const FSYNC_SKIP_START_TTL_MS = 60000;
export declare function hasFsyncSkipStartTime(callID: string): boolean;
export declare function stopFsyncSkipWarningCleanup(): void;
export declare function createFsyncSkipWarningHook(): {
    "tool.execute.before": (input: ToolExecuteInput, _output: ToolBeforeOutput) => Promise<void>;
    "tool.execute.after": (input: ToolExecuteInput, output: ToolAfterOutput) => Promise<void>;
    dispose: typeof stopFsyncSkipWarningCleanup;
};
export {};
