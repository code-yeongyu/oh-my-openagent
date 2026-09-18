import type { ClaudeHooksConfig, PluginHooksConfig } from "./types";
export declare function getClaudeSettingsPaths(customPath?: string): string[];
export declare function clearClaudeHooksConfigCache(): void;
export declare function resetPluginHooksState(): void;
export declare function setPluginHooksConfigs(directory: string, configs: PluginHooksConfig[]): void;
export declare function mergePluginHooksConfigs(base: ClaudeHooksConfig, pluginHooksConfigs: PluginHooksConfig[]): ClaudeHooksConfig;
export declare function loadClaudeHooksConfig(customSettingsPath?: string): Promise<ClaudeHooksConfig | null>;
