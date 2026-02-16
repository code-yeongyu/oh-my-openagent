import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test"
import {
  findNearestMessageWithFields,
  findFirstMessageWithAgent,
  findNearestMessageWithFieldsFromSDK,
  findFirstMessageWithAgentFromSDK,
  injectHookMessage,
} from "./injector"
import { isSqliteBackend, resetSqliteBackendCache } from "../../shared/opencode-storage-detection"

//#region Mocks

const mockIsSqliteBackend = vi.fn()

vi.mock("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: mockIsSqliteBackend,
  resetSqliteBackendCache: () => {},
}))

//#endregion

//#region Test Helpers

function createMockClient(messages: Array<{
  info?: {
    agent?: string
    model?: { providerID?: string; modelID?: string; variant?: string }
    providerID?: string
    modelID?: string
    tools?: Record<string, boolean>
  }
}>): {
  session: {
    messages: (opts: { path: { id: string } }) => Promise<{ data: typeof messages }>
  }
} {
  return {
    session: {
      messages: async () => ({ data: messages }),
    },
  }
}

//#endregion

describe("findNearestMessageWithFieldsFromSDK", () => {
  it("returns message with all fields when available", async () => {
    const mockClient = createMockClient([
      { info: { agent: "sisyphus", model: { providerID: "anthropic", modelID: "claude-opus-4" } } },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as any, "ses_123")

    expect(result).toEqual({
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
      tools: undefined,
    })
  })

  it("returns message with assistant shape (providerID/modelID directly on info)", async () => {
    const mockClient = createMockClient([
      { info: { agent: "sisyphus", providerID: "openai", modelID: "gpt-5" } },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as any, "ses_123")

    expect(result).toEqual({
      agent: "sisyphus",
      model: { providerID: "openai", modelID: "gpt-5" },
      tools: undefined,
    })
  })

  it("returns nearest (most recent) message with all fields", async () => {
    const mockClient = createMockClient([
      { info: { agent: "old-agent", model: { providerID: "old", modelID: "model" } } },
      { info: { agent: "new-agent", model: { providerID: "new", modelID: "model" } } },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as any, "ses_123")

    expect(result?.agent).toBe("new-agent")
  })

  it("falls back to message with partial fields", async () => {
    const mockClient = createMockClient([
      { info: { agent: "partial-agent" } },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as any, "ses_123")

    expect(result?.agent).toBe("partial-agent")
  })

  it("returns null when no messages have useful fields", async () => {
    const mockClient = createMockClient([
      { info: {} },
      { info: {} },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as any, "ses_123")

    expect(result).toBeNull()
  })

  it("returns null when messages array is empty", async () => {
    const mockClient = createMockClient([])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as any, "ses_123")

    expect(result).toBeNull()
  })

  it("returns null on SDK error", async () => {
    const mockClient = {
      session: {
        messages: async () => {
          throw new Error("SDK error")
        },
      },
    }

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as any, "ses_123")

    expect(result).toBeNull()
  })

  it("includes tools when available", async () => {
    const mockClient = createMockClient([
      {
        info: {
          agent: "sisyphus",
          model: { providerID: "anthropic", modelID: "claude-opus-4" },
          tools: { edit: true, write: false },
        },
      },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as any, "ses_123")

    expect(result?.tools).toEqual({ edit: true, write: false })
  })
})

describe("findFirstMessageWithAgentFromSDK", () => {
  it("returns agent from first message", async () => {
    const mockClient = createMockClient([
      { info: { agent: "first-agent" } },
      { info: { agent: "second-agent" } },
    ])

    const result = await findFirstMessageWithAgentFromSDK(mockClient as any, "ses_123")

    expect(result).toBe("first-agent")
  })

  it("skips messages without agent field", async () => {
    const mockClient = createMockClient([
      { info: {} },
      { info: { agent: "first-real-agent" } },
    ])

    const result = await findFirstMessageWithAgentFromSDK(mockClient as any, "ses_123")

    expect(result).toBe("first-real-agent")
  })

  it("returns null when no messages have agent", async () => {
    const mockClient = createMockClient([
      { info: {} },
      { info: {} },
    ])

    const result = await findFirstMessageWithAgentFromSDK(mockClient as any, "ses_123")

    expect(result).toBeNull()
  })

  it("returns null on SDK error", async () => {
    const mockClient = {
      session: {
        messages: async () => {
          throw new Error("SDK error")
        },
      },
    }

    const result = await findFirstMessageWithAgentFromSDK(mockClient as any, "ses_123")

    expect(result).toBeNull()
  })
})

describe("injectHookMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns false and logs warning on beta/SQLite backend", () => {
    mockIsSqliteBackend.mockReturnValue(true)

    const result = injectHookMessage("ses_123", "test content", {
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })

    expect(result).toBe(false)
    expect(mockIsSqliteBackend).toHaveBeenCalled()
  })

  it("returns false for empty hook content", () => {
    mockIsSqliteBackend.mockReturnValue(false)

    const result = injectHookMessage("ses_123", "", {
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })

    expect(result).toBe(false)
  })

  it("returns false for whitespace-only hook content", () => {
    mockIsSqliteBackend.mockReturnValue(false)

    const result = injectHookMessage("ses_123", "   \n\t  ", {
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4" },
    })

    expect(result).toBe(false)
  })
})
