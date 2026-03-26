import { beforeEach } from "bun:test"
import { _resetForTesting as resetClaudeSessionState } from "./src/features/claude-code-session-state/state"
import { _resetForTesting as resetModelFallbackState } from "./src/hooks/model-fallback/hook"

beforeEach(() => {
  resetClaudeSessionState()
  resetModelFallbackState()
})
