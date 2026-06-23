/// <reference types="bun-types" />

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { ClaudeMemHttpClient, ClaudeMemHttpClientError } from "./http-client"

describe("ClaudeMemHttpClient", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", { value: originalFetch, configurable: true })
  })

  describe("health", () => {
    test("returns parsed JSON on success", async () => {
      //#given
      const fetchMock = async () =>
        new Response(JSON.stringify({ status: "ok", version: "1.2.3", worker_pid: 42 }), {
          status: 200,
        })
      Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })
      const client = new ClaudeMemHttpClient()

      //#when
      const result = await client.health()

      //#then
      expect(result.status).toBe("ok")
      expect(result.version).toBe("1.2.3")
      expect(result.worker_pid).toBe(42)
    })

    test("throws ClaudeMemHttpClientError on non-ok response", async () => {
      //#given
      const fetchMock = async () => new Response("server error", { status: 500 })
      Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })
      const client = new ClaudeMemHttpClient()

      //#when / then
      let caught: unknown
      try {
        await client.health()
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(ClaudeMemHttpClientError)
      expect((caught as ClaudeMemHttpClientError).statusCode).toBe(500)
    })
  })

  describe("search", () => {
    test("builds correct URL params and returns parsed results", async () => {
      //#given
      let capturedUrl = ""
      const fetchMock = async (input: string | URL) => {
        capturedUrl = typeof input === "string" ? input : input.toString()
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 1,
                time: "2026-04-11T00:00:00Z",
                type: "bugfix",
                title: "Fixed race condition",
                project: "memory-provider",
              },
            ],
            total: 1,
          }),
          { status: 200 },
        )
      }
      Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })
      const client = new ClaudeMemHttpClient()

      //#when
      const result = await client.search({
        q: "race condition",
        limit: 10,
        project: "memory-provider",
        obs_type: "bugfix",
        date_start: "2026-01-01",
        date_end: "2026-12-31",
        type: "observations",
      })

      //#then
      expect(capturedUrl).toContain("/api/search?")
      expect(capturedUrl).toContain("query=race+condition")
      expect(capturedUrl).not.toContain("q=race+condition")
      expect(capturedUrl).toContain("limit=10")
      expect(capturedUrl).toContain("project=memory-provider")
      expect(capturedUrl).toContain("obs_type=bugfix")
      expect(capturedUrl).toContain("date_start=2026-01-01")
      expect(capturedUrl).toContain("date_end=2026-12-31")
      expect(capturedUrl).toContain("type=observations")
      expect(result.total).toBe(1)
      expect(result.results[0]?.title).toBe("Fixed race condition")
    })

    test("throws on non-ok response", async () => {
      //#given
      const fetchMock = async () => new Response("bad request", { status: 400 })
      Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })
      const client = new ClaudeMemHttpClient()

      //#when / then
      let caught: unknown
      try {
        await client.search({ q: "hello" })
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(ClaudeMemHttpClientError)
      expect((caught as ClaudeMemHttpClientError).statusCode).toBe(400)
    })
  })

  describe("addObservation", () => {
    test("initializes the session and then posts an observation with correct bodies", async () => {
      //#given
      const capturedCalls: Array<{ url: string; init?: RequestInit }> = []
      const fetchMock = async (input: string | URL, init?: RequestInit) => {
        capturedCalls.push({
          url: typeof input === "string" ? input : input.toString(),
          init,
        })
        return new Response("", { status: 200 })
      }
      Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })
      const client = new ClaudeMemHttpClient()

      //#when
      await client.addObservation({
        session_id: "sess-1",
        tool_name: "Write",
        tool_input: { path: "/tmp/foo.ts" },
        tool_response: "ok",
        cwd: "/tmp",
      })

      //#then
      expect(capturedCalls).toHaveLength(2)
      expect(capturedCalls[0]?.url).toContain("/api/sessions/init")
      expect(capturedCalls[1]?.url).toContain("/api/sessions/observations")
      expect(capturedCalls[0]?.init?.method).toBe("POST")
      expect(capturedCalls[1]?.init?.method).toBe("POST")
      const headers = capturedCalls[1]?.init?.headers as Record<string, string>
      expect(headers["Content-Type"]).toBe("application/json")
      const initBody = JSON.parse(capturedCalls[0]?.init?.body as string) as Record<string, unknown>
      const observationBody = JSON.parse(capturedCalls[1]?.init?.body as string) as Record<string, unknown>
      expect(initBody.contentSessionId).toBe("sess-1")
      expect(initBody.project).toBe("claude-mem")
      expect(initBody.prompt).toBe("[memory orchestrator]")
      expect(observationBody.contentSessionId).toBe("sess-1")
      expect(observationBody.tool_name).toBe("Write")
    })

    test("throws on non-ok response", async () => {
      //#given
      const fetchMock = async () => new Response("nope", { status: 422 })
      Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })
      const client = new ClaudeMemHttpClient()

      //#when / then
      let caught: unknown
      try {
        await client.addObservation({ session_id: "s", tool_name: "Bash" })
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(ClaudeMemHttpClientError)
      expect((caught as ClaudeMemHttpClientError).statusCode).toBe(422)
    })
  })

  describe("fetchWithTimeout", () => {
    test("aborts after timeoutMs and throws ClaudeMemHttpClientError", async () => {
      //#given
      const fetchMock = async (_input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.")
            err.name = "AbortError"
            reject(err)
          })
        })
      Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })
      const client = new ClaudeMemHttpClient({ timeoutMs: 20 })

      //#when / then
      let caught: unknown
      try {
        await client.health()
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(ClaudeMemHttpClientError)
      expect((caught as Error).message).toContain("timed out after 20ms")
    })
  })

  describe("isWorkerProcessAlive", () => {
    test("returns false when PID file is missing", async () => {
      //#given
      const client = new ClaudeMemHttpClient({
        pidFilePath: "/nonexistent/path/that/does/not/exist/.claude-mem/worker.pid",
      })

      //#when
      const alive = await client.isWorkerProcessAlive()

      //#then
      expect(alive).toBe(false)
    })

    test("returns false when pidFilePath is empty", async () => {
      //#given
      const client = new ClaudeMemHttpClient({ pidFilePath: "" })

      //#when
      const alive = await client.isWorkerProcessAlive()

      //#then
      expect(alive).toBe(false)
    })
  })
})
