import type { PluginInput } from "@opencode-ai/plugin";
type SdkSession = PluginInput["client"]["session"];
type SdkPromptAsync = SdkSession["promptAsync"];
type SdkStatus = SdkSession["status"];
type SdkMessages = SdkSession["messages"];
export type TeamIdleWakeHintNarrowClient = {
    session: {
        promptAsync?: SdkPromptAsync;
        status?: SdkStatus;
        messages?: SdkMessages;
    };
};
export declare function buildTeamIdleWakeHintClient(client: PluginInput["client"]): TeamIdleWakeHintNarrowClient;
export {};
