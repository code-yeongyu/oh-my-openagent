import type { OhMyOpenCodeConfig } from "../config";
import type { PluginHooksConfig } from "../hooks/claude-code-hooks/types";
export type PluginComponents = {
    commands: Record<string, unknown>;
    skills: Record<string, unknown>;
    agents: Record<string, unknown>;
    mcpServers: Record<string, unknown>;
    hooksConfigs: PluginHooksConfig[];
    plugins: Array<{
        name: string;
        version: string;
    }>;
    errors: Array<{
        pluginKey: string;
        installPath: string;
        error: string;
    }>;
    retryableLoadFailure?: true;
};
export declare function loadPluginComponents(params: {
    pluginConfig: OhMyOpenCodeConfig;
}): Promise<PluginComponents>;
