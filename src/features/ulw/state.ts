import { loadPersistedUlwEnabled, persistUlwEnabled } from "./persistence"

const DEFAULT_ENABLED = false

let enabled = DEFAULT_ENABLED
let initialized = false

export function initializeUlwState(defaultEnabled: boolean | undefined): void {
  if (initialized) return
  initialized = true

  const persisted = loadPersistedUlwEnabled()
  if (typeof persisted === "boolean") {
    enabled = persisted
    return
  }

  if (typeof defaultEnabled === "boolean") {
    enabled = defaultEnabled
    persistUlwEnabled(defaultEnabled)
  }
}

export function isUlwEnabled(): boolean {
  return enabled
}

export function setUlwEnabled(nextEnabled: boolean): void {
  enabled = nextEnabled
  initialized = true
  persistUlwEnabled(nextEnabled)
}

/** @internal For testing only */
export function _resetUlwForTesting(): void {
  enabled = DEFAULT_ENABLED
  initialized = false
}
