import type { PluginInput } from "@opencode-ai/plugin";
export declare const HOOK_NAME: "ulw-execute";
interface UlwExecuteHookInput {
    sessionID: string;
    messageID?: string;
}
interface UlwExecuteCommandExecuteBeforeInput {
    sessionID: string;
    command: string;
    arguments: string;
}
interface UlwExecuteHookOutput {
    message?: Record<string, unknown>;
    parts: Array<{
        type: string;
        text?: string;
    }>;
}
export declare function createUlwExecuteHook(ctx: PluginInput): {
    "chat.message": (input: UlwExecuteHookInput, output: UlwExecuteHookOutput) => Promise<void>;
    "command.execute.before": (input: UlwExecuteCommandExecuteBeforeInput, output: UlwExecuteHookOutput) => Promise<void>;
};
export {};
