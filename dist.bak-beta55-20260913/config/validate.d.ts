import type { OmoConfigEnv } from "@oh-my-opencode/omo-config-core";
import { type OhMyOpenCodeConfig } from "./schema";
export type PluginConfigValidation = {
    readonly valid: boolean;
    readonly messages: readonly string[];
    readonly path: string | null;
    readonly config: OhMyOpenCodeConfig;
};
export declare function _setDeprecationWarningSinkForTesting(sink: (message: string) => void): void;
export declare function _resetDeprecationWarningSinkForTesting(): void;
export declare function validatePluginConfig(directory: string, environment?: OmoConfigEnv): PluginConfigValidation;
