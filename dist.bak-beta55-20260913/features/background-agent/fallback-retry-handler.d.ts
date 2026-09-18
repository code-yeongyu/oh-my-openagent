import type { BackgroundTask } from "./types";
import type { ConcurrencyManager } from "./concurrency";
import type { OpencodeClient, QueueItem } from "./constants";
import { log, readConnectedProvidersCache, readProviderModelsCache } from "../../shared";
import { shouldRetryError, getNextFallback, hasMoreFallbacks, selectFallbackProvider } from "../../shared/model-error-classifier";
import { transformModelForProvider } from "../../shared/provider-model-id-transform";
export declare class TeamModeFallbackError extends Error {
    constructor(message: string);
}
export type FallbackRetryHandlerDeps = {
    log: typeof log;
    readProviderModelsCache: typeof readProviderModelsCache;
    readConnectedProvidersCache: typeof readConnectedProvidersCache;
    shouldRetryError: typeof shouldRetryError;
    getNextFallback: typeof getNextFallback;
    hasMoreFallbacks: typeof hasMoreFallbacks;
    selectFallbackProvider: typeof selectFallbackProvider;
    transformModelForProvider: typeof transformModelForProvider;
    isProviderExhaustionFallbackEligible: (error: unknown) => boolean;
};
export declare function tryFallbackRetry(args: {
    task: BackgroundTask;
    errorInfo: {
        name?: string;
        message?: string;
        statusCode?: number;
    };
    source: string;
    concurrencyManager: ConcurrencyManager;
    client: OpencodeClient;
    idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>;
    queuesByKey: Map<string, QueueItem[]>;
    processKey: (key: string) => void;
    onRetrying?: (details: {
        task: BackgroundTask;
        source: string;
        previousSessionID?: string;
        failedModel?: string;
        failedError?: string;
        nextModel: string;
    }) => void;
    deps?: Partial<FallbackRetryHandlerDeps>;
}): Promise<boolean>;
