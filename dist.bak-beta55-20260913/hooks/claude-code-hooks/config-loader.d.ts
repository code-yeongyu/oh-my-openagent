import type { ClaudeHookEvent } from "./types";
export interface DisabledHooksConfig {
    Stop?: string[];
    PreToolUse?: string[];
    PostToolUse?: string[];
    PostToolUseFailure?: string[];
    PermissionRequest?: string[];
    UserPromptSubmit?: string[];
    Notification?: string[];
    SubagentStart?: string[];
    SubagentStop?: string[];
    SessionStart?: string[];
    SessionEnd?: string[];
    PreCompact?: string[];
}
export interface PluginExtendedConfig {
    disabledHooks?: DisabledHooksConfig;
}
export declare function clearPluginExtendedConfigCache(): void;
export declare function loadPluginExtendedConfig(): Promise<PluginExtendedConfig>;
export declare function isHookCommandDisabled(eventType: ClaudeHookEvent, command: string, config: PluginExtendedConfig | null): boolean;
