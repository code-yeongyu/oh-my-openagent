/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createHttpCuratorInvoker, CuratorInvokerError } from "./invoker"

function mockFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  const impl = async (input: Request | string | URL, init?: RequestInit) => {
    return handler(String(input), init ?? {})
  }
  return impl as unknown as typeof fetch
}

describe("createHttpCuratorInvoker", () => {
  describe("#given a healthy adapter returning a valid curator response", () => {
    test("#when invoked #then parses decisions from the assistant message", async () => {
      const fetchImpl = mockFetch(() =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: '```json\n{"decisions":[{"action":"NOOP","memory_id":"m_x","reason":"ok"}],"summary":"1 noop","warnings":[]}\n```',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )

      const invoker = createHttpCuratorInvoker({ fetchImpl })
      const response = await invoker.invoke({
        recent_memories: [],
        related_memories: [],
        project_id: "p1",
        batch_size_hint: 20,
      })

      expect(response.decisions).toHaveLength(1)
      expect(response.decisions[0]?.action).toBe("NOOP")
      expect(response.summary).toBe("1 noop")
    })
  })

  describe("#given the adapter returns a non-200 status", () => {
    test("#when invoked #then throws CuratorInvokerError with status", async () => {
      const fetchImpl = mockFetch(() =>
        new Response(JSON.stringify({ error: "boom" }), { status: 502 }),
      )

      const invoker = createHttpCuratorInvoker({ fetchImpl })
      await expect(
        invoker.invoke({
          recent_memories: [],
          related_memories: [],
          project_id: "p1",
          batch_size_hint: 20,
        }),
      ).rejects.toThrow(CuratorInvokerError)
    })
  })

  describe("#given the adapter returns 200 with no message content", () => {
    test("#when invoked #then throws CuratorInvokerError about missing content", async () => {
      const fetchImpl = mockFetch(() =>
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      )

      const invoker = createHttpCuratorInvoker({ fetchImpl })
      await expect(
        invoker.invoke({
          recent_memories: [],
          related_memories: [],
          project_id: "p1",
          batch_size_hint: 20,
        }),
      ).rejects.toThrow(/no assistant message content/i)
    })
  })

  describe("#given an authToken", () => {
    test("#when invoked #then Bearer header is attached", async () => {
      let capturedAuth = ""
      const fetchImpl = mockFetch((_url, init) => {
        const headers = new Headers(init.headers)
        capturedAuth = headers.get("authorization") ?? ""
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: '{"decisions":[],"summary":"","warnings":[]}',
                },
              },
            ],
          }),
          { status: 200 },
        )
      })

      const invoker = createHttpCuratorInvoker({ fetchImpl, authToken: "secret-xyz" })
      await invoker.invoke({
        recent_memories: [],
        related_memories: [],
        project_id: "p1",
        batch_size_hint: 20,
      })

      expect(capturedAuth).toBe("Bearer secret-xyz")
    })
  })

  describe("#given a custom model", () => {
    test("#when invoked #then request body uses that model", async () => {
      let capturedModel: string | undefined
      const fetchImpl = mockFetch((_url, init) => {
        const body = JSON.parse(String(init.body ?? "{}")) as { model?: string }
        capturedModel = body.model
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: '{"decisions":[],"summary":"","warnings":[]}',
                },
              },
            ],
          }),
          { status: 200 },
        )
      })

      const invoker = createHttpCuratorInvoker({ fetchImpl, model: "gpt-5-nano" })
      await invoker.invoke({
        recent_memories: [],
        related_memories: [],
        project_id: "p1",
        batch_size_hint: 20,
      })

      expect(capturedModel).toBe("gpt-5-nano")
    })
  })

  describe("#given invoker is called", () => {
    test("#when invoked #then system prompt is the Mnemosyne prompt", async () => {
      let capturedMessages: Array<{ role: string; content: string }> = []
      const fetchImpl = mockFetch((_url, init) => {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          messages: Array<{ role: string; content: string }>
        }
        capturedMessages = body.messages
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: '{"decisions":[],"summary":"","warnings":[]}',
                },
              },
            ],
          }),
          { status: 200 },
        )
      })

      const invoker = createHttpCuratorInvoker({ fetchImpl })
      await invoker.invoke({
        recent_memories: [{ memory_id: "m1" }],
        related_memories: [],
        project_id: "super-agent",
        batch_size_hint: 10,
      })

      expect(capturedMessages).toHaveLength(2)
      expect(capturedMessages[0]?.role).toBe("system")
      expect(capturedMessages[0]?.content).toContain("MNEMOSYNE")
      expect(capturedMessages[1]?.role).toBe("user")
      const userPayload = JSON.parse(capturedMessages[1]?.content ?? "{}") as {
        project_id: string
        batch_size_hint: number
      }
      expect(userPayload.project_id).toBe("super-agent")
      expect(userPayload.batch_size_hint).toBe(10)
    })
  })
})
