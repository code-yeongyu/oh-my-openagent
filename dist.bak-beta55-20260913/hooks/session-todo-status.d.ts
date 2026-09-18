import type { PluginInput } from "@opencode-ai/plugin";
export declare function hasIncompleteTodos(ctx: PluginInput, sessionID: string): Promise<boolean>;
export declare function hasPendingSessionWork(ctx: PluginInput, sessionID: string): Promise<boolean>;
