import { describe, it, expect, mock, beforeEach } from "bun:test"

type OpencodeHttpApi = typeof import("./opencode-http-api")

const opencodeHttpApiSpecifier = import.meta.resolve("./opencode-http-api")

const log = mock(() => {})
const getServerBasicAuthHeader = mock(() => "Basic b3BlbmNvZGU6dGVzdHBhc3N3b3Jk")
const fetchImplementation = mock(async (): Promise<Response> => new Response(null, { status: 200 }))

async function loadOpencodeHttpApi(): Promise<OpencodeHttpApi> {
  const opencodeHttpApi = await import(`${opencodeHttpApiSpecifier}?test=${crypto.randomUUID()}`)
  opencodeHttpApi._setFetchImplementationForTesting(fetchImplementation)
  opencodeHttpApi._setLogImplementationForTesting(log)
  opencodeHttpApi._setServerBasicAuthHeaderResolverForTesting(getServerBasicAuthHeader)
  return opencodeHttpApi
}

describe("getServerBaseUrl", () => {
  it("returns baseUrl from client._client.getConfig().baseUrl", async () => {
    // given
    const { getServerBaseUrl } = await loadOpencodeHttpApi()
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

  it("returns baseUrl from client.session._client.getConfig().baseUrl when first attempt fails", async () => {
    // given
    const { getServerBaseUrl } = await loadOpencodeHttpApi()
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

  it("returns null for incompatible client", async () => {
    // given
    const { getServerBaseUrl } = await loadOpencodeHttpApi()
    const mockClient = {}

    // when
    const result = getServerBaseUrl(mockClient)

    // then
    expect(result).toBeNull()
  })
})

describe("patchPart", () => {
  beforeEach(() => {
    log.mockClear()
    getServerBasicAuthHeader.mockClear()
    getServerBasicAuthHeader.mockReturnValue("Basic b3BlbmNvZGU6dGVzdHBhc3N3b3Jk")
    fetchImplementation.mockClear()
    fetchImplementation.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it("constructs correct URL and sends PATCH with auth", async () => {
    // given
    const { patchPart } = await loadOpencodeHttpApi()
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
    expect(fetchImplementation).toHaveBeenCalledWith(
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
    const { patchPart } = await loadOpencodeHttpApi()
    const mockClient = {
      _client: {
        getConfig: () => ({ baseUrl: "https://api.example.com" }),
      },
    }
    fetchImplementation.mockRejectedValue(new Error("Network error"))

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
    log.mockClear()
    getServerBasicAuthHeader.mockClear()
    getServerBasicAuthHeader.mockReturnValue("Basic b3BlbmNvZGU6dGVzdHBhc3N3b3Jk")
    fetchImplementation.mockClear()
    fetchImplementation.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it("constructs correct URL and sends DELETE", async () => {
    // given
    const { deletePart } = await loadOpencodeHttpApi()
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
    expect(fetchImplementation).toHaveBeenCalledWith(
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
    const { deletePart } = await loadOpencodeHttpApi()
    const mockClient = {
      _client: {
        getConfig: () => ({ baseUrl: "https://api.example.com" }),
      },
    }
    fetchImplementation.mockResolvedValue(new Response(null, { status: 404 }))

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
