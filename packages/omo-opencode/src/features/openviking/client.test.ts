import { describe, it, expect, mock, beforeEach } from "bun:test"
import { OpenVikingClient, createOpenVikingClient } from "./client"
import {
  OpenVikingError,
  OpenVikingNetworkError,
  OpenVikingTimeoutError,
  type HealthResponse,
  type RecallResponse,
  type CommitResponse,
  type Session,
} from "./types"

describe("OpenVikingClient", () => {
  let mockFetch: ReturnType<typeof mock>
  let client: OpenVikingClient

  beforeEach(() => {
    mockFetch = mock(() => Promise.resolve(new Response()))
    client = new OpenVikingClient(
      {
        url: "http://localhost:1933",
        api_key: "test-api-key",
      },
      mockFetch
    )
  })

  describe("constructor", () => {
    it("should create client with default config", () => {
      const client = new OpenVikingClient(
        {
          url: "http://localhost:1933",
        },
        mockFetch
      )

      expect(client.getUrl()).toBe("http://localhost:1933")
      expect(client.hasApiKey()).toBe(false)
    })

    it("should create client with custom config", () => {
      const client = new OpenVikingClient(
        {
          url: "https://openviking.example.com",
          api_key: "test-key",
        },
        mockFetch
      )

      expect(client.getUrl()).toBe("https://openviking.example.com")
      expect(client.hasApiKey()).toBe(true)
    })

    it("should remove trailing slash from URL", () => {
      const client = new OpenVikingClient(
        {
          url: "http://localhost:1933/",
        },
        mockFetch
      )

      expect(client.getUrl()).toBe("http://localhost:1933")
    })
  })

  describe("health", () => {
    it("should return health status on success", async () => {
      // given
      const mockResponse: HealthResponse = {
        status: "healthy",
        version: "1.0.0",
        uptime_seconds: 3600,
        memory_count: 100,
        session_count: 10,
      }

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )

      // when
      const result = await client.health()

      // then
      expect(result).toEqual(mockResponse)
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:1933/health",
        expect.objectContaining({
          method: "GET",
        })
      )
    })

    it("should include Authorization header when API key is set", async () => {
      // given
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "healthy" }), {
          status: 200,
        })
      )

      // when
      await client.health()

      // then
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        })
      )
    })

    it("should throw OpenVikingError on HTTP error", async () => {
      // given
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Internal server error" }),
          { status: 500, statusText: "Internal Server Error" }
        )
      )

      // when/then
      await expect(client.health()).rejects.toThrow(OpenVikingError)
    })

    it("should throw OpenVikingNetworkError on network error", async () => {
      // given
      mockFetch.mockRejectedValueOnce(new TypeError("Network error"))

      // when/then
      await expect(client.health()).rejects.toThrow(OpenVikingNetworkError)
    })
  })

  describe("recall", () => {
    it("should recall memories with query", async () => {
      // given
      const mockResponse: RecallResponse = {
        memories: [
          {
            id: "mem-1",
            content: "User prefers TypeScript",
            type: "preferences",
            score: 0.95,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ],
        total: 1,
        query: "TypeScript",
        duration_ms: 150,
      }

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
        })
      )

      // when
      const result = await client.recall("TypeScript")

      // then
      expect(result).toEqual(mockResponse)
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:1933/api/v1/memories/recall",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            query: "TypeScript",
            limit: 5,
          }),
        })
      )
    })

    it("should filter by memory types", async () => {
      // given
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ memories: [], total: 0 }), {
          status: 200,
        })
      )

      // when
      await client.recall("test", ["preferences", "patterns"])

      // then
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: "test",
            types: ["preferences", "patterns"],
            limit: 5,
          }),
        })
      )
    })

    it("should respect limit parameter", async () => {
      // given
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ memories: [], total: 0 }), {
          status: 200,
        })
      )

      // when
      await client.recall("test", undefined, 10)

      // then
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: "test",
            limit: 10,
          }),
        })
      )
    })
  })

  describe("commit", () => {
    it("should commit session", async () => {
      // given
      const session: Session = {
        id: "session-123",
        messages: [
          {
            role: "user",
            content: "Hello",
            timestamp: "2024-01-01T00:00:00Z",
          },
          {
            role: "assistant",
            content: "Hi there!",
            timestamp: "2024-01-01T00:00:01Z",
          },
        ],
        created_at: "2024-01-01T00:00:00Z",
      }

      const mockResponse: CommitResponse = {
        success: true,
        session_id: "session-123",
        task_id: "task-456",
      }

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
        })
      )

      // when
      const result = await client.commit(session)

      // then
      expect(result).toEqual(mockResponse)
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:1933/api/v1/sessions/commit",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            session,
            extract_memories: true,
            generate_summaries: true,
          }),
        })
      )
    })

    it("should disable memory extraction when requested", async () => {
      // given
      const session: Session = {
        id: "session-123",
        messages: [],
        created_at: "2024-01-01T00:00:00Z",
      }

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, session_id: "session-123" }), {
          status: 200,
        })
      )

      // when
      await client.commit(session, false, false)

      // then
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            session,
            extract_memories: false,
            generate_summaries: false,
          }),
        })
      )
    })
  })
})

describe("createOpenVikingClient", () => {
  it("should create client instance", () => {
    // given
    const mockFetch = mock(() => Promise.resolve(new Response()))

    // when
    const client = createOpenVikingClient(
      {
        url: "http://localhost:1933",
      },
      mockFetch
    )

    // then
    expect(client).toBeInstanceOf(OpenVikingClient)
  })
})

describe("Error classes", () => {
  it("should create OpenVikingError", () => {
    // given/when
    const error = new OpenVikingError("Test error", 400, "BAD_REQUEST")

    // then
    expect(error.message).toBe("Test error")
    expect(error.statusCode).toBe(400)
    expect(error.code).toBe("BAD_REQUEST")
    expect(error.name).toBe("OpenVikingError")
  })

  it("should create OpenVikingNetworkError", () => {
    // given
    const cause = new Error("Network failure")

    // when
    const error = new OpenVikingNetworkError("Network error", cause)

    // then
    expect(error.message).toBe("Network error")
    expect(error.code).toBe("NETWORK_ERROR")
    expect(error.cause).toBe(cause)
    expect(error.name).toBe("OpenVikingNetworkError")
  })

  it("should create OpenVikingTimeoutError", () => {
    // given/when
    const error = new OpenVikingTimeoutError("Timeout", 2000)

    // then
    expect(error.message).toBe("Timeout")
    expect(error.code).toBe("TIMEOUT_ERROR")
    expect(error.timeout_ms).toBe(2000)
    expect(error.name).toBe("OpenVikingTimeoutError")
  })
})
