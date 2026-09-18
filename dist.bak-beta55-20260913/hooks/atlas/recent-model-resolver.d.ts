import type { PluginInput } from "@opencode-ai/plugin";
import { findNearestMessageWithFields, findNearestMessageWithFieldsFromSDK } from "../../features/hook-message-injector";
import { getMessageDir, isSqliteBackend } from "../../shared";
import type { ModelInfo } from "./types";
type PromptContext = {
    model?: ModelInfo;
    tools?: Record<string, boolean>;
};
type RecentPromptContextDeps = {
    isSqliteBackend: typeof isSqliteBackend;
    getMessageDir: typeof getMessageDir;
    findNearestMessageWithFields: typeof findNearestMessageWithFields;
    findNearestMessageWithFieldsFromSDK: typeof findNearestMessageWithFieldsFromSDK;
};
export declare function resolveRecentPromptContextForSession(ctx: PluginInput, sessionID: string, deps?: RecentPromptContextDeps): Promise<PromptContext>;
export declare function resolveRecentModelForSession(ctx: PluginInput, sessionID: string): Promise<ModelInfo | undefined>;
export {};
