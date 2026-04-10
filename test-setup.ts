import { beforeEach } from "bun:test"
import { _resetForTesting as resetClaudeSessionState } from "./src/features/claude-code-session-state/state"
import { _resetForTesting as resetModelFallbackState } from "./src/hooks/model-fallback/hook"
import { _resetTodoContinuationEnforcersForTesting } from "./src/hooks/todo-continuation-enforcer"
import { _resetMemCacheForTesting as resetConnectedProvidersCache } from "./src/shared/connected-providers-cache"
import { __resetTimingConfig as resetDelegateTaskTimingConfig } from "./src/tools/delegate-task/timing"

beforeEach(() => {
  resetClaudeSessionState()
  resetModelFallbackState()
  _resetTodoContinuationEnforcersForTesting()
  resetConnectedProvidersCache()
  resetDelegateTaskTimingConfig()
})
