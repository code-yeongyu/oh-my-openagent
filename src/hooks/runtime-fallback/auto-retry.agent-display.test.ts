import { describe, it, expect, vi, beforeEach } from "vitest"
import { createAutoRetryHelpers } from "./auto-retry"
import { getAgentDisplayName } from "../../shared/agent-display-names"

// Mock dependencies
vi.mock("../../shared/logger", () => ({
  log: vi.fn(),
}))

vi.mock("../../shared/agent-display-names", () => ({
  getAgentDisplayName: vi.fn((key) => {
    const displayNames: Record<string, string> = {
      atlas: "Atlas (Plan Executor)",
      sisyphus: "Sisyphus (Ultraworker)",
      "sisyphus-junior": "Sisyphus-Junior",
      prometheus: "Prometheus (Plan Builder)",
      hephaestus: "Hephaestus (Deep Agent)",
    }
    return displayNames[key] || key
  }),
}))

vi.mock("./agent-resolver", () => ({
  normalizeAgentName: vi.fn((name) => name?.toLowerCase()),
  resolveAgentForSession: vi.fn(),
}))

vi.mock("../../features/claude-code-session-state", () => ({
  getSessionAgent: vi.fn(),
}))

vi.mock("../../shared/session-model-state", () => ({
  setSessionModel: vi.fn(),
}))

vi.mock("./fallback-models", () => ({
  getFallbackModelsForSession: vi.fn(() => []),
}))

describe("auto-retry agent display name conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should convert atlas config key to display name", () => {
    const configKey = "atlas"
    const displayName = getAgentDisplayName(configKey)
    
    expect(displayName).toBe("Atlas (Plan Executor)")
  })

  it("should convert sisyphus-junior config key to display name", () => {
    const configKey = "sisyphus-junior"
    const displayName = getAgentDisplayName(configKey)
    
    expect(displayName).toBe("Sisyphus-Junior")
  })

  it("should convert sisyphus config key to display name", () => {
    const configKey = "sisyphus"
    const displayName = getAgentDisplayName(configKey)
    
    expect(displayName).toBe("Sisyphus (Ultraworker)")
  })

  it("should handle unknown agent keys gracefully", () => {
    const configKey = "unknown-agent"
    const displayName = getAgentDisplayName(configKey)
    
    expect(displayName).toBe("unknown-agent")
  })

  it("should handle undefined agent gracefully", () => {
    const configKey = undefined as unknown as string
    const displayName = configKey ? getAgentDisplayName(configKey) : undefined
    
    expect(displayName).toBeUndefined()
  })
})
