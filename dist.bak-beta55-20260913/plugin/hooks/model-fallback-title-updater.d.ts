import type { PluginContext } from "../types";
export type ModelFallbackTitleInput = {
    readonly sessionID: string;
    readonly providerID: string;
    readonly modelID: string;
    readonly variant?: string;
};
export declare function createModelFallbackTitleUpdater(ctx: PluginContext): (input: ModelFallbackTitleInput) => Promise<void>;
