import {
  getNextFallback,
  hasMoreFallbacks,
  isRetryableModelError,
  selectFallbackProviderWithCache,
  shouldRetryError,
} from "@oh-my-opencode/model-core"
import type { ErrorInfo } from "@oh-my-opencode/model-core"
import * as connectedProvidersCache from "./connected-providers-cache"

export type { ErrorInfo }
export {
  isRetryableModelError,
  shouldRetryError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProviderWithCache,
}

export function selectFallbackProvider(
  providers: string[],
  preferredProviderID?: string,
): string {
  return selectFallbackProviderWithCache(
    providers,
    connectedProvidersCache,
    preferredProviderID,
  )
}
