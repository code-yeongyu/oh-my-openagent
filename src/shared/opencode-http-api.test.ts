import { describe, it, expect, vi, beforeEach } from "bun:test"
import { getServerBaseUrl, patchPart, deletePart } from "./opencode-http-api"

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock log
vi.mock("./logger", () => ({
  log: vi.fn(),
}))

import { log } from "./logger"

describe("getServerBaseUrl", () => {
  it("returns baseUrl from client._client.getConfig().baseUrl", () => {
    // given
    const mockClient = {
      _client: {
        getConfig: () => ({ baseUrl: "https://api.example.com" }),
      },
    }

    // when
    const result = getServerBaseUrl(mockClient)

    // then
    expect(result).toBe("https://api.example.com")
  })

  it("returns baseUrl from client.session._client.getConfig().baseUrl when first attempt fails", () => {
    // given
    const mockClient = {
      _client: {
        getConfig: () => ({}),
      },
      session: {
        _client: {
          getConfig: () => ({ baseUrl: "https://session.example.com" }),
        },
      },
    }

    // when
    const result = getServerBaseUrl(mockClient)

    // then
    expect(result).toBe("https://session.example.com")
  })

  it("returns null for incompatible client", () => {
    // given
    const mockClient = {}

    // when
    const result = getServerBaseUrl(mockClient)

    // then
    expect(result).toBeNull()
  })
})

describe("patchPart", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true })
    process.env.OPENCODE_SERVER_PASSWORD = "testpassword"
    process.env.OPENCODE_SERVER_USERNAME = "opencode"
  })

  it("constructs correct URL and sends PATCH with auth", async () => {
    // given
    const mockClient = {
      _client: {
        getConfig: () => ({ baseUrl: "https://api.example.com" }),
      },
    }
    const sessionID = "ses123"
    const messageID = "msg456"
    const partID = "part789"
    const body = { content: "test" }

    // when
    const result = await patchPart(mockClient, sessionID, messageID, partID, body)

    // then
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/session/ses123/message/msg456/part/part789",
      expect.objectContaining({
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Basic b3BlbmNvZGU6dGVzdHBhc3N3b3Jk",
        },
        body: JSON.stringify(body),
        signal: expect.any(AbortSignal),
      })
    )
  })

  it("returns false on network error", async () => {
    // given
    const mockClient = {
      _client: {
        getConfig: () => ({ baseUrl: "https://api.example.com" }),
      },
    }
    mockFetch.mockRejectedValue(new Error("Network error"))

    // when
    const result = await patchPart(mockClient, "ses123", "msg456", "part789", {})

    // then
    expect(result).toBe(false)
    expect(log).toHaveBeenCalledWith("[opencode-http-api] PATCH error", {
      message: "Network error",
      url: "https://api.example.com/session/ses123/message/msg456/part/part789",
    })
  })
})

describe("deletePart", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true })
    process.env.OPENCODE_SERVER_PASSWORD = "testpassword"
    process.env.OPENCODE_SERVER_USERNAME = "opencode"
  })

  it("constructs correct URL and sends DELETE", async () => {
    // given
    const mockClient = {
      _client: {
        getConfig: () => ({ baseUrl: "https://api.example.com" }),
      },
    }
    const sessionID = "ses123"
    const messageID = "msg456"
    const partID = "part789"

    // when
    const result = await deletePart(mockClient, sessionID, messageID, partID)

    // then
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/session/ses123/message/msg456/part/part789",
      expect.objectContaining({
        method: "DELETE",
        headers: {
          "Authorization": "Basic b3BlbmNvZGU6dGVzdHBhc3N3b3Jk",
        },
        signal: expect.any(AbortSignal),
      })
    )
  })

  it("returns false on non-ok response", async () => {
    // given
    const mockClient = {
      _client: {
        getConfig: () => ({ baseUrl: "https://api.example.com" }),
      },
    }
    mockFetch.mockResolvedValue({ ok: false, status: 404 })

    // when
    const result = await deletePart(mockClient, "ses123", "msg456", "part789")

    // then
    expect(result).toBe(false)
    expect(log).toHaveBeenCalledWith("[opencode-http-api] DELETE failed", {
      status: 404,
      url: "https://api.example.com/session/ses123/message/msg456/part/part789",
    })
  })
})