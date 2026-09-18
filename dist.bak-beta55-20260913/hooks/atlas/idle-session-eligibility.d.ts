import type { PluginInput } from "@opencode-ai/plugin";
export declare function canContinueTrackedBoulderSession(input: {
    client: PluginInput["client"];
    sessionID: string;
    sessionOrigin?: "direct" | "appended";
    boulderSessionIDs: string[];
    requiredAgent?: string;
}): Promise<boolean>;
