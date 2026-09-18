import type { PluginInput } from "@opencode-ai/plugin";
type ToolExecuteBeforeInput = {
    tool: string;
    sessionID: string;
    callID: string;
};
type ToolExecuteBeforeOutput = {
    args: Record<string, unknown>;
};
export interface CompactionTodoPreserver {
    capture: (sessionID: string) => Promise<void>;
    restore: (sessionID: string) => Promise<void>;
    event: (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    "tool.execute.before": (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput) => Promise<void>;
}
export declare function createCompactionTodoPreserverHook(ctx: PluginInput): CompactionTodoPreserver;
export {};
