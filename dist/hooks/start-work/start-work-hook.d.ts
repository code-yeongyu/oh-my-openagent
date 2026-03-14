import type { PluginInput } from "@opencode-ai/plugin";
export declare const HOOK_NAME: "start-work";
interface StartWorkHookInput {
    sessionID: string;
    messageID?: string;
}
interface StartWorkHookOutput {
    parts: Array<{
        type: string;
        text?: string;
    }>;
}
export declare function createStartWorkHook(ctx: PluginInput): {
    "chat.message": (input: StartWorkHookInput, output: StartWorkHookOutput) => Promise<void>;
};
export {};
