import { beforeEach } from "bun:test"
import { _resetForTesting as resetClaudeSessionState } from "./src/features/claude-code-session-state/state"
import { _resetForTesting as resetModelFallbackState } from "./src/hooks/model-fallback/hook"
import { _resetMemCacheForTesting as resetConnectedProvidersCache } from "./src/shared/connected-providers-cache"

beforeEach(() => {
  resetClaudeSessionState()
  resetModelFallbackState()
  resetConnectedProvidersCache()
})
