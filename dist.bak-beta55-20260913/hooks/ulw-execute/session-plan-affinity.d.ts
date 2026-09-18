import type { PluginInput } from "@opencode-ai/plugin";
export declare function findRecentSessionPlanPath(input: {
    client: PluginInput["client"];
    directory: string;
    sessionID: string;
    availablePlans: string[];
}): Promise<string | null>;
