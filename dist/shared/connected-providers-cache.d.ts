interface ModelMetadata {
    id: string;
    provider?: string;
    context?: number;
    output?: number;
    name?: string;
}
interface ProviderModelsCache {
    models: Record<string, string[] | ModelMetadata[]>;
    connected: string[];
    updatedAt: string;
}
/**
 * Read the connected providers cache.
 * Returns the list of connected provider IDs, or null if cache doesn't exist.
 */
export declare function readConnectedProvidersCache(): string[] | null;
/**
 * Check if connected providers cache exists.
 */
export declare function hasConnectedProvidersCache(): boolean;
/**
 * Read the provider-models cache.
 * Returns the cache data, or null if cache doesn't exist.
 */
export declare function readProviderModelsCache(): ProviderModelsCache | null;
/**
 * Check if provider-models cache exists.
 */
export declare function hasProviderModelsCache(): boolean;
/**
 * Write the provider-models cache.
 */
export declare function writeProviderModelsCache(data: {
    models: Record<string, string[]>;
    connected: string[];
}): void;
/**
 * Update the connected providers cache by fetching from the client.
 * Also updates the provider-models cache with model lists per provider.
 */
export declare function updateConnectedProvidersCache(client: {
    provider?: {
        list?: () => Promise<{
            data?: {
                connected?: string[];
                all?: Array<{
                    id: string;
                    models?: Record<string, unknown>;
                }>;
            };
        }>;
    };
}): Promise<void>;
export {};
