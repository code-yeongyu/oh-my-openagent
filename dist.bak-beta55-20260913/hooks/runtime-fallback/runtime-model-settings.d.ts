import type { OhMyOpenCodeConfig } from "../../config";
export type RuntimeModelSettings = {
    reasoning?: string;
    reasoningEffort?: string;
};
export declare function resolveRuntimeModelSettings(sessionID: string, agent: string | undefined, pluginConfig: OhMyOpenCodeConfig | undefined): RuntimeModelSettings;
