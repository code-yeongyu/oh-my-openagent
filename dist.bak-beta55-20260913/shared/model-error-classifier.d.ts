import { getNextFallback, hasMoreFallbacks, isRetryableModelError, selectFallbackProviderWithCache, shouldRetryError } from "@oh-my-opencode/model-core";
import type { ErrorInfo } from "@oh-my-opencode/model-core";
export type { ErrorInfo };
export { isRetryableModelError, shouldRetryError, getNextFallback, hasMoreFallbacks, selectFallbackProviderWithCache, };
export declare function selectFallbackProvider(providers: string[], preferredProviderID?: string): string;
