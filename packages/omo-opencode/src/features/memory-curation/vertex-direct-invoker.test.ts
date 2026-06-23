/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { CuratorInvokerError } from "./invoker"
import {
  createVertexDirectCuratorInvoker,
  type VertexTokenProvider,
} from "./vertex-direct-invoker"

function mockFetch(
  handler: (url: string, init: RequestInit) => Response,
): typeof fetch {
  const impl = async (input: Request | string | URL, init?: RequestInit) => {
    return handler(String(input), init ?? {})
  }
  return impl as unknown as typeof fetch
}

function buildTokenProvider(initial: string): VertexTokenProvider {
  let current = initial
  let refreshCount = 0
  return {
    async getAccessToken() {
      return current
    },
    async invalidateAndRefresh() {
      refreshCount++
      current = `refreshed-${refreshCount}`
      return current
    },
  }
}

describe("createVertexDirectCuratorInvoker", () => {
  describe("#given a valid curator response", () => {
    test("#when invoked #then calls the correct Vertex endpoint with provided model", async () => {
      let capturedUrl = ""
      let capturedBody: Record<string, unknown> | undefined
      const fetchImpl = mockFetch((url, init) => {
        capturedUrl = url
        capturedBody = JSON.parse(String(init.body ?? "{}"))
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: '{"decisions":[],"summary":"ok","warnings":[]}',
                },
              },
            ],
          }),
          { status: 200 },
        )
      })

      const invoker = createVertexDirectCuratorInvoker({
        projectId: "my-project-xyz",
        model: "google/gemini-3.1-pro-preview",
        tokenProvider: buildTokenProvider("t1"),
        fetchImpl,
      })

      await invoker.invoke({
        recent_memories: [],
        related_memories: [],
        project_id: "p1",
        batch_size_hint: 20,
      })

      expect(capturedUrl).toContain("aiplatform.googleapis.com")
      expect(capturedUrl).toContain("projects/my-project-xyz")
      expect(capturedUrl).toContain("locations/global")
      expect(capturedBody?.model).toBe("google/gemini-3.1-pro-preview")
    })

    test("#when invoked #then attaches Bearer token", async () => {
      let capturedAuth = ""
      const fetchImpl = mockFetch((_url, init) => {
        const headers = new Headers(init.headers)
        capturedAuth = headers.get("authorization") ?? ""
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"decisions":[],"summary":"","warnings":[]}' } }],
          }),
          { status: 200 },
        )
      })

      const invoker = createVertexDirectCuratorInvoker({
        projectId: "p",
        tokenProvider: buildTokenProvider("token-abc"),
        fetchImpl,
      })
      await invoker.invoke({
        recent_memories: [],
        related_memories: [],
        project_id: "p1",
        batch_size_hint: 20,
      })

      expect(capturedAuth).toBe("Bearer token-abc")
    })

    test("#when invoked #then system message is the Mnemosyne curator prompt", async () => {
      let systemContent = ""
      const fetchImpl = mockFetch((_url, init) => {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          messages: Array<{ role: string; content: string }>
        }
        systemContent = body.messages[0]?.content ?? ""
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"decisions":[],"summary":"","warnings":[]}' } }],
          }),
          { status: 200 },
        )
      })

      const invoker = createVertexDirectCuratorInvoker({
        projectId: "p",
        tokenProvider: buildTokenProvider("t"),
        fetchImpl,
      })
      await invoker.invoke({
        recent_memories: [],
        related_memories: [],
        project_id: "p",
        batch_size_hint: 20,
      })

      expect(systemContent).toContain("MNEMOSYNE")
    })
  })

  describe("#given Vertex returns 401", () => {
    test("#when token has invalidateAndRefresh #then refreshes and retries once", async () => {
      let callCount = 0
      const fetchImpl = mockFetch((_url, init) => {
        callCount++
        const headers = new Headers(init.headers)
        const auth = headers.get("authorization")
        if (auth === "Bearer initial") {
          return new Response(
            JSON.stringify({ error: { code: 401, message: "stale" } }),
            { status: 401 },
          )
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"decisions":[],"summary":"","warnings":[]}' } }],
          }),
          { status: 200 },
        )
      })

      const invoker = createVertexDirectCuratorInvoker({
        projectId: "p",
        tokenProvider: buildTokenProvider("initial"),
        fetchImpl,
      })
      const response = await invoker.invoke({
        recent_memories: [],
        related_memories: [],
        project_id: "p",
        batch_size_hint: 20,
      })

      expect(callCount).toBe(2)
      expect(response.decisions).toEqual([])
    })
  })

  describe("#given Vertex returns 500", () => {
    test("#when invoked #then throws CuratorInvokerError", async () => {
      const fetchImpl = mockFetch(() =>
        new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
      )

      const invoker = createVertexDirectCuratorInvoker({
        projectId: "p",
        tokenProvider: buildTokenProvider("t"),
        fetchImpl,
      })

      await expect(
        invoker.invoke({
          recent_memories: [],
          related_memories: [],
          project_id: "p",
          batch_size_hint: 20,
        }),
      ).rejects.toThrow(CuratorInvokerError)
    })
  })

  describe("#given Vertex returns empty choices", () => {
    test("#when invoked #then throws", async () => {
      const fetchImpl = mockFetch(() =>
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      )

      const invoker = createVertexDirectCuratorInvoker({
        projectId: "p",
        tokenProvider: buildTokenProvider("t"),
        fetchImpl,
      })

      await expect(
        invoker.invoke({
          recent_memories: [],
          related_memories: [],
          project_id: "p",
          batch_size_hint: 20,
        }),
      ).rejects.toThrow(/no assistant message content/i)
    })
  })

  describe("#given custom location", () => {
    test("#when invoked #then URL uses that location", async () => {
      let capturedUrl = ""
      const fetchImpl = mockFetch((url) => {
        capturedUrl = url
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"decisions":[],"summary":"","warnings":[]}' } }],
          }),
          { status: 200 },
        )
      })

      const invoker = createVertexDirectCuratorInvoker({
        projectId: "p",
        location: "us-central1",
        tokenProvider: buildTokenProvider("t"),
        fetchImpl,
      })
      await invoker.invoke({
        recent_memories: [],
        related_memories: [],
        project_id: "p",
        batch_size_hint: 20,
      })

      expect(capturedUrl).toContain("locations/us-central1")
    })
  })
})
