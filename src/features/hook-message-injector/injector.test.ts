import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  findNearestMessageWithFields,
  findFirstMessageWithAgent,
  findNearestMessageWithFieldsFromSDK,
  findFirstMessageWithAgentFromSDK,
  generateMessageId,
  generatePartId,
  injectHookMessage,
} from "./injector"
import { isSqliteBackend, resetSqliteBackendCache } from "../../shared/opencode-storage-detection"

//#region Mocks

const mockIsSqliteBackend = vi.fn()
const tempDirs: string[] = []

vi.mock("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: mockIsSqliteBackend,
  resetSqliteBackendCache: () => {},
}))

//#endregion

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

function createMessageDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-injector-message-dir-"))
  tempDirs.push(directory)
  mkdirSync(directory, { recursive: true })
  return directory
}

//#region Test Helpers

function createMockClient(messages: Array<{
  id?: string
  info?: {
    agent?: string
    model?: { providerID?: string; modelID?: string; variant?: string }
    providerID?: string
    modelID?: string
    tools?: Record<string, boolean>
    time?: { created?: number }
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
      { id: "msg_old", info: { agent: "old-agent", model: { providerID: "old", modelID: "model" }, time: { created: 10 } } },
      { id: "msg_new", info: { agent: "new-agent", model: { providerID: "new", modelID: "model" }, time: { created: 20 } } },
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

  it("uses message time.created rather than SDK array order when resolving nearest message", async () => {
    const mockClient = createMockClient([
      { id: "msg_newer", info: { agent: "older-array-entry", model: { providerID: "openai", modelID: "gpt-5" }, time: { created: 10 } } },
      { id: "msg_older", info: { agent: "newest-by-time", model: { providerID: "openai", modelID: "gpt-5" }, time: { created: 100 } } },
    ])

    const result = await findNearestMessageWithFieldsFromSDK(mockClient as any, "ses_123")

    expect(result?.agent).toBe("newest-by-time")
  })
})

describe("findNearestMessageWithFields JSON backend ordering", () => {
  it("uses message time.created rather than filename order", () => {
    mockIsSqliteBackend.mockReturnValue(false)
    const messageDir = createMessageDir()
    writeFileSync(join(messageDir, "msg_ffff0000_000001.json"), JSON.stringify({
      agent: "older-by-time",
      model: { providerID: "openai", modelID: "gpt-5" },
      time: { created: 10 },
    }))
    writeFileSync(join(messageDir, "msg_00000000_000999.json"), JSON.stringify({
      agent: "newest-by-time",
      model: { providerID: "openai", modelID: "gpt-5" },
      time: { created: 100 },
    }))

    const result = findNearestMessageWithFields(messageDir)

    expect(result?.agent).toBe("newest-by-time")
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

  it("uses message time.created rather than SDK array order when resolving first agent", async () => {
    const mockClient = createMockClient([
      { id: "msg_late", info: { agent: "later-agent", time: { created: 100 } } },
      { id: "msg_early", info: { agent: "earliest-agent", time: { created: 10 } } },
    ])

    const result = await findFirstMessageWithAgentFromSDK(mockClient as any, "ses_123")

    expect(result).toBe("earliest-agent")
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

describe("generateMessageId", () => {
  it("returns deterministic sequential IDs with fixed format", () => {
    // given
    const format = /^msg_[0-9a-f]{8}_\d{6}$/

    // when
    const firstId = generateMessageId()
    const secondId = generateMessageId()

    // then
    expect(firstId).toMatch(format)
    expect(secondId).toMatch(format)
    expect(secondId.split("_")[1]).toBe(firstId.split("_")[1])
    expect(Number(secondId.split("_")[2])).toBe(Number(firstId.split("_")[2]) + 1)
  })
})

describe("generatePartId", () => {
  it("returns deterministic sequential IDs with fixed format", () => {
    // given
    const format = /^prt_[0-9a-f]{8}_\d{6}$/

    // when
    const firstId = generatePartId()
    const secondId = generatePartId()

    // then
    expect(firstId).toMatch(format)
    expect(secondId).toMatch(format)
    expect(secondId.split("_")[1]).toBe(firstId.split("_")[1])
    expect(Number(secondId.split("_")[2])).toBe(Number(firstId.split("_")[2]) + 1)
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
