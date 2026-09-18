import type { PluginInput } from "@opencode-ai/plugin";
type OpencodeClient = PluginInput["client"];
type ModelListClient = OpencodeClient & {
    model?: {
        list?: () => Promise<unknown>;
    };
};
/**
 * Fuzzy match a target model name against available models
 *
 * @param target - The model name or substring to search for (e.g., "gpt-5.4", "claude-opus")
 * @param available - Set of available model names in format "provider/model-name"
 * @param providers - Optional array of provider names to filter by (e.g., ["openai", "anthropic"])
 * @returns The matched model name or null if no match found
 *
 * Matching priority:
 * 1. Exact match (if exists)
 * 2. Shorter model name (more specific)
 *
 * Matching is case-insensitive substring match.
 * If providers array is given, only models starting with "provider/" are considered.
 *
 * @example
 * const available = new Set(["openai/gpt-5.4", "openai/gpt-5.5", "anthropic/claude-opus-4-7"])
 * fuzzyMatchModel("gpt-5.4", available) // → "openai/gpt-5.4"
 * fuzzyMatchModel("claude", available, ["openai"]) // → null (provider filter excludes anthropic)
 */
export declare function fuzzyMatchModel(target: string, available: Set<string>, providers?: string[]): string | null;
export declare function isModelAvailable(targetModel: string, availableModels: Set<string>): boolean;
export declare function getConnectedProviders(client: OpencodeClient): Promise<string[]>;
export declare function fetchAvailableModels(client?: ModelListClient, options?: {
    connectedProviders?: string[] | null;
}): Promise<Set<string>>;
export declare function __resetModelCache(): void;
export declare function isModelCacheAvailable(): boolean;
export {};
