import type { FallbackEntry } from "./model-requirements";
export declare function parseFallbackModelEntry(model: string, contextProviderID: string | undefined, defaultProviderID?: string): FallbackEntry | undefined;
export declare function buildFallbackChainFromModels(fallbackModels: string | string[] | undefined, contextProviderID: string | undefined, defaultProviderID?: string): FallbackEntry[] | undefined;
