import { describe, expect, test } from "bun:test"
import { handleCompletions } from "./completions"
import { createAccountPool, type AccountPool } from "../account-pool"
import type { ChatExecutorOutput } from "../deepseek-chat-executor"
import type { PoolAccount } from "../pool-types"
import type { executeChatCompletionStream } from "../streaming-chat-executor"
import type {
  ProbeProvider,
  ProviderCredentials,
} from "../../providers/provider-types"

const stubProvider: ProbeProvider = {
  id: "stub",
  kind: "deepseek_web",
  healthCheck: async () => ({ ok: true, message: "", checked_at: 0 }),
  refreshCredentials: async () => ({ success: true, refresh_type: "" }),
  rotateCredentials: async () => ({ success: false, rotation_type: "" }),
  dispatchProbe: async () => ({
    status: 0,
    headers: {},
    body: "",
    timing: { total_ms: 0 },
    identity_used: null,
    fingerprint_used: null,
    retry_count: 0,
  }),
  getRateLimits: () => ({ rps: null, rpm: null, tpm: null, cooldown_on_429_s: 0 }),
  getErrorTaxonomy: () => ({ rate_limited_signals: [], blocked_signals: [] }),
  getSupportedModels: () => [],
}

function makeRequest(opts: {
  method?: string
  body?: unknown
  headers?: Record<string, string>
} = {}): Request {
  const init: RequestInit = {
    method: opts.method ?? "POST",
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  }
  if (opts.body !== undefined) {
    init.body =
      typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)
  }
  return new Request("http://x/v1/chat/completions", init)
}

const validBody = {
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "hi" }],
}

const successExecutor = (() => {
  const fn = async (): Promise<ChatExecutorOutput> => ({
    ok: true,
    response: {
      id: "chatcmpl-rid-1",
      object: "chat.completion",
      created: 1000,
      model: "deepseek-v4-flash",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ciao" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    },
  })
  return fn as unknown as typeof import("../deepseek-chat-executor").executeChatCompletion
})()

const failingExecutor = (() => {
  const fn = async (): Promise<ChatExecutorOutput> => ({
    ok: false,
    httpStatus: 502,
    errorType: "empty_sse",
    message: "empty sse",
  })
  return fn as unknown as typeof import("../deepseek-chat-executor").executeChatCompletion
})()

const stubCreds: ProviderCredentials = {
  id: "stub",
  name: "stub",
  provider_type: "deepseek_web",
  base_url: "https://chat.deepseek.com",
  auth_type: "cookie_session",
  auth_config: "{}",
  default_headers: null,
  rate_limit_rps: null,
  rate_limit_rpm: null,
  rate_limit_tpm: null,
  cooldown_on_429_s: 0,
  supported_models: null,
  health_check_url: null,
  health_check_interval_s: 0,
  status: "active",
  created_at: 0,
  updated_at: 0,
}

function okPool(): AccountPool {
  const account: PoolAccount = {
    id: "stub",
    provider: stubProvider,
    baseUrl: "https://chat.deepseek.com",
    creds: stubCreds,
  }
  return createAccountPool({ accounts: [account] })
}

describe("handleCompletions", () => {
  describe("#given stream:true with mocked streaming executor", () => {
    test("#when posted #then routes to streaming executor and returns its Response unchanged", async () => {
      const sentinelHeader = "x-streaming-sentinel"
      const streamingExec: typeof executeChatCompletionStream = async () =>
        new Response("data: [DONE]\n\n", {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            [sentinelHeader]: "yes",
          },
        })
      const pool = okPool()
      const r = await handleCompletions(
        makeRequest({ body: { ...validBody, stream: true } }),
        {
          streamingExecutor: streamingExec,
          pool,
        },
      )
      expect(r.status).toBe(200)
      expect(r.headers.get("content-type")).toMatch(/text\/event-stream/)
      expect(r.headers.get(sentinelHeader)).toBe("yes")
      pool.shutdown()
    })
  })

  describe("#given a tool role message without tool_call_id (V0.9.2)", () => {
    test("#when posted #then translator rejects with 400 invalid_request_error", async () => {
      const pool = okPool()
      const r = await handleCompletions(
        makeRequest({
          body: {
            model: "deepseek-v4-flash",
            messages: [
              { role: "user", content: "q" },
              { role: "tool", content: "tool-out" },
            ],
          },
        }),
        { pool },
      )
      expect(r.status).toBe(400)
      const body = (await r.json()) as { error: { type: string; message: string } }
      expect(body.error.type).toBe("invalid_request_error")
      expect(body.error.message).toMatch(/tool_call_id/i)
      pool.shutdown()
    })
  })

  describe("#given a function role message (V0.9.2 legacy reject)", () => {
    test("#when posted #then translator rejects with 400 invalid_request_error pointing to tool", async () => {
      const pool = okPool()
      const r = await handleCompletions(
        makeRequest({
          body: {
            model: "deepseek-v4-flash",
            messages: [
              { role: "user", content: "q" },
              { role: "function", content: "x" },
            ],
          },
        }),
        { pool },
      )
      expect(r.status).toBe(400)
      const body = (await r.json()) as { error: { type: string; message: string } }
      expect(body.error.type).toBe("invalid_request_error")
      expect(body.error.message).toMatch(/function/i)
      pool.shutdown()
    })
  })

  describe("#given GET method", () => {
    test("#when called #then returns 405", async () => {
      const r = await handleCompletions(makeRequest({ method: "GET" }))
      expect(r.status).toBe(405)
    })
  })

  describe("#given malformed JSON", () => {
    test("#when posted #then returns 400", async () => {
      const r = await handleCompletions(makeRequest({ body: "{nope" }))
      expect(r.status).toBe(400)
    })
  })

  describe("#given missing model field", () => {
    test("#when posted #then returns 400 invalid_request_error", async () => {
      const r = await handleCompletions(
        makeRequest({ body: { messages: [{ role: "user", content: "x" }] } }),
      )
      expect(r.status).toBe(400)
    })
  })

  describe("#given valid stream:false body with mocked executor (success)", () => {
    test("#when posted #then returns 200 with OpenAI body and x-request-id header", async () => {
      const pool = okPool()
      const r = await handleCompletions(
        makeRequest({ body: validBody, headers: { "x-request-id": "rid-1" } }),
        {
          executor: successExecutor,
          pool,
          requestId: "rid-1",
        },
      )
      expect(r.status).toBe(200)
      expect(r.headers.get("x-request-id")).toBe("rid-1")
      const body = (await r.json()) as {
        id: string
        choices: Array<{ message: { content: string } }>
      }
      expect(body.id).toBe("chatcmpl-rid-1")
      expect(body.choices[0]!.message.content).toBe("ciao")
      pool.shutdown()
    })
  })

  describe("#given executor returns failure", () => {
    test("#when posted #then propagates httpStatus + errorType to OpenAI envelope", async () => {
      const pool = okPool()
      const r = await handleCompletions(makeRequest({ body: validBody }), {
        executor: failingExecutor,
        pool,
      })
      expect(r.status).toBe(502)
      const body = (await r.json()) as { error: { type: string } }
      expect(body.error.type).toBe("empty_sse")
      pool.shutdown()
    })
  })

  describe("#given pool loader throws", () => {
    test("#when posted #then returns 500 internal_error", async () => {
      const failingPoolLoader = () => {
        throw new Error("no provider registered")
      }
      const r = await handleCompletions(makeRequest({ body: validBody }), {
        poolLoader: failingPoolLoader as unknown as typeof import("../pool-factory").loadAccountPool,
      })
      expect(r.status).toBe(500)
      const body = (await r.json()) as {
        error: { type: string; message: string }
      }
      expect(body.error.type).toBe("internal_error")
      expect(body.error.message).toMatch(/no provider registered/)
    })
  })

  describe("#given pool acquire times out", () => {
    test("#when posted #then returns 503 rate_limit_error", async () => {
      const pool = okPool()
      const r1 = await pool.acquire()
      const r2 = await pool.acquire()
      const res = await handleCompletions(makeRequest({ body: validBody }), {
        pool,
        acquireTimeoutMs: 30,
      })
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: { type: string } }
      expect(body.error.type).toBe("rate_limit_error")
      r1.release()
      r2.release()
      pool.shutdown()
    })
  })

  describe("#given stream:false success #when posted #then pool slot is released after response", () => {
    test("release on stream:false", async () => {
      const pool = okPool()
      const r = await handleCompletions(makeRequest({ body: validBody }), {
        pool,
        executor: successExecutor,
      })
      await r.json()
      const r2 = await pool.acquire(50)
      expect(r2.account.id).toBe("stub")
      r2.release()
      pool.shutdown()
    })
  })

  describe("#given stream:true success #when posted and body fully consumed #then pool slot is released after stream completes", () => {
    test("release on stream:true completion", async () => {
      const pool = okPool()
      const streamingExec: typeof executeChatCompletionStream = async () => {
        const enc = new TextEncoder()
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(enc.encode("data: [DONE]\n\n"))
              c.close()
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          },
        )
      }
      const r = await handleCompletions(
        makeRequest({ body: { ...validBody, stream: true } }),
        { pool, streamingExecutor: streamingExec },
      )
      await r.text()
      const r2 = await pool.acquire(50)
      expect(r2.account.id).toBe("stub")
      r2.release()
      pool.shutdown()
    })
  })

  describe("#given stream:true with back-to-back cancel + close #then release fires exactly once (one-shot guard)", () => {
    test("one-shot release on cancel + close race", async () => {
      const pool = okPool()
      let releaseCount = 0
      const wrappedAcquire = async () => {
        const r = await pool.acquire()
        return {
          account: r.account,
          release: () => {
            releaseCount++
            r.release()
          },
        }
      }
      const wrappedPool = { ...pool, acquire: wrappedAcquire } as AccountPool
      const streamingExec: typeof executeChatCompletionStream = async () => {
        const enc = new TextEncoder()
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(enc.encode("data: chunk-1\n\n"))
              c.close()
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          },
        )
      }
      const r = await handleCompletions(
        makeRequest({ body: { ...validBody, stream: true } }),
        { pool: wrappedPool, streamingExecutor: streamingExec },
      )
      const reader = r.body!.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) chunks.push(value)
      }
      void reader.cancel("late-cancel")
      await new Promise((rr) => setTimeout(rr, 20))
      expect(releaseCount).toBe(1)
      pool.shutdown()
    })
  })

  describe("#given stream:true response.body cancelled mid-flight #then pool slot is released after cancel", () => {
    test("release on stream:true cancel", async () => {
      const pool = okPool()
      const streamingExec: typeof executeChatCompletionStream = async () => {
        const enc = new TextEncoder()
        return new Response(
          new ReadableStream<Uint8Array>({
            async start(c) {
              c.enqueue(enc.encode("data: chunk-1\n\n"))
              await new Promise((r) => setTimeout(r, 200))
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          },
        )
      }
      const r = await handleCompletions(
        makeRequest({ body: { ...validBody, stream: true } }),
        { pool, streamingExecutor: streamingExec },
      )
      await r.body!.cancel("client-bye")
      const r2 = await pool.acquire(50)
      expect(r2.account.id).toBe("stub")
      r2.release()
      pool.shutdown()
    })
  })

  describe("#given unknown model (V0.10.3 capability gate)", () => {
    test("#when POST /v1/chat/completions #then returns 400 model_not_found before pool acquisition", async () => {
      const pool = okPool()
      const r = await handleCompletions(
        makeRequest({
          body: {
            model: "deepseek-v3",
            messages: [{ role: "user", content: "hi" }],
            stream: false,
          },
        }),
        { pool },
      )
      expect(r.status).toBe(400)
      const body = (await r.json()) as {
        error: { type: string; code?: string; message: string }
      }
      expect(body.error.type).toBe("invalid_request_error")
      expect(body.error.code).toBe("model_not_found")
      expect(body.error.message).toMatch(/deepseek-v3/)
      expect(body.error.message).toMatch(/deepseek-v4-pro/)
      const a1 = await pool.acquire(50)
      const a2 = await pool.acquire(50)
      expect(a1.account.id).toBe("stub")
      expect(a2.account.id).toBe("stub")
      a1.release()
      a2.release()
      pool.shutdown()
    })
  })

  describe("#given vision model with extra_body.search_enabled=true (V0.10.6 capability gate)", () => {
    test("#when POST /v1/chat/completions #then returns 400 search_unsupported before pool acquisition", async () => {
      const pool = okPool()
      const r = await handleCompletions(
        makeRequest({
          body: {
            model: "deepseek-v4-vision",
            messages: [{ role: "user", content: "hi" }],
            stream: false,
            search_enabled: true,
          },
        }),
        { pool },
      )
      expect(r.status).toBe(400)
      const body = (await r.json()) as {
        error: { type: string; code?: string; message: string }
      }
      expect(body.error.type).toBe("invalid_request_error")
      expect(body.error.code).toBe("search_unsupported")
      const a1 = await pool.acquire(50)
      const a2 = await pool.acquire(50)
      expect(a1.account.id).toBe("stub")
      expect(a2.account.id).toBe("stub")
      a1.release()
      a2.release()
      pool.shutdown()
    })
  })
})
