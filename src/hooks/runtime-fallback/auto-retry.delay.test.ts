import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock dependencies before importing
vi.mock("../../shared/logger", () => ({
  log: vi.fn(),
}))

vi.mock("../../shared/agent-display-names", () => ({
  getAgentDisplayName: vi.fn((key) => key),
}))

vi.mock("./agent-resolver", () => ({
  normalizeAgentName: vi.fn((name) => name?.toLowerCase()),
  resolveAgentForSession: vi.fn(),
}))

vi.mock("../../features/claude-code-session-state", () => ({
  getSessionAgent: vi.fn(() => "test-agent"),
}))

vi.mock("../../shared/session-model-state", () => ({
  setSessionModel: vi.fn(),
}))

vi.mock("./fallback-models", () => ({
  getFallbackModelsForSession: vi.fn(() => ["provider/fallback-model"]),
}))

vi.mock("./fallback-state", () => ({
  prepareFallback: vi.fn(() => Promise.resolve({ success: true, newModel: "provider/fallback-model" })),
}))

vi.mock("../../shared/session-category-registry", () => ({
  SessionCategoryRegistry: {
    remove: vi.fn(),
  },
}))

vi.mock("./retry-model-payload", () => ({
  buildRetryModelPayload: vi.fn(() => ({
    model: { providerID: "provider", modelID: "fallback-model" },
  })),
}))

vi.mock("./last-user-retry-parts", () => ({
  getLastUserRetryParts: vi.fn(() => [{ type: "text", text: "test message" }]),
}))

vi.mock("./session-messages", () => ({
  extractSessionMessages: vi.fn(() => []),
}))

import { createAutoRetryHelpers } from "./auto-retry"

describe("auto-retry delay functionality", () => {
  let mockCtx: any
  let mockDeps: any
  
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    
    mockCtx = {
      directory: "/test/dir",
      client: {
        session: {
          messages: vi.fn(() => Promise.resolve({ data: [] })),
          promptAsync: vi.fn(() => Promise.resolve()),
          abort: vi.fn(() => Promise.resolve()),
        },
      },
    }
    
    mockDeps = {
      ctx: mockCtx,
      config: {
        enabled: true,
        retry_on_errors: [],
        max_fallback_attempts: 3,
        cooldown_seconds: 60,
        timeout_seconds: 120,
        notify_on_fallback: false,
      },
      options: {},
      pluginConfig: {},
      sessionStates: new Map(),
      sessionLastAccess: new Map(),
      sessionRetryInFlight: new Set(),
      sessionAwaitingFallbackResult: new Set(),
      sessionFallbackTimeouts: new Map(),
      sessionStatusRetryKeys: new Map(),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should add 100ms delay before promptAsync call", async () => {
    const helpers = createAutoRetryHelpers(mockDeps)
    
    // Setup session state
    mockDeps.sessionStates.set("test-session", {
      currentModel: "provider/original-model",
      originalModel: "provider/original-model",
      attemptCount: 0,
      pending: false,
    })
    
    // Start the autoRetryWithFallback
    const retryPromise = helpers.autoRetryWithFallback(
      "test-session",
      "provider/fallback-model",
      "atlas",
      "test-source"
    )
    
    // Fast-forward past the delay
    await vi.advanceTimersByTimeAsync(100)
    
    // Wait for the promise to complete
    await retryPromise
    
    // Verify promptAsync was called after the delay
    expect(mockCtx.client.session.promptAsync).toHaveBeenCalled()
  })

  it("should include agent with display name in promptAsync body", async () => {
    const helpers = createAutoRetryHelpers(mockDeps)
    
    mockDeps.sessionStates.set("test-session", {
      currentModel: "provider/original-model",
      originalModel: "provider/original-model",
      attemptCount: 0,
      pending: false,
    })
    
    const retryPromise = helpers.autoRetryWithFallback(
      "test-session",
      "provider/fallback-model",
      "atlas",
      "test-source"
    )
    
    await vi.advanceTimersByTimeAsync(100)
    await retryPromise
    
    // Verify promptAsync was called with correct structure
    const promptAsyncCall = mockCtx.client.session.promptAsync.mock.calls[0]
    expect(promptAsyncCall).toBeDefined()
    expect(promptAsyncCall[0].body).toBeDefined()
    expect(promptAsyncCall[0].body.agent).toBeDefined()
  })
})
