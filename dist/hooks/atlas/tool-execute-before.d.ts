import type { PluginInput } from "@opencode-ai/plugin";
export declare function createToolExecuteBeforeHandler(input: {
    ctx: PluginInput;
    pendingFilePaths: Map<string, string>;
}): (toolInput: {
    tool: string;
    sessionID?: string;
    callID?: string;
}, toolOutput: {
    args: Record<string, unknown>;
    message?: string;
}) => Promise<void>;
