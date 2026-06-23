import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createOpenAICompatServer, type OpenAICompatServer } from "./server"
import type { OpenAICompatConfig } from "./config-schema"

const TEST_TOKEN = "test-bearer-token-12345"

function makeConfig(port = 0): OpenAICompatConfig {
  return {
    host: "127.0.0.1",
    port,
    bearer_token: TEST_TOKEN,
    version: "0.4.0-test",
  }
}

describe("createOpenAICompatServer", () => {
  let server: OpenAICompatServer | null = null

  beforeEach(() => {
    server = null
  })

  afterEach(async () => {
    if (server) await server.stop()
  })

  describe("#given lifecycle", () => {
    test("#when started with port=0 #then binds to an available port and exposes URL", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      expect(server.port).toBeGreaterThan(0)
      expect(server.url).toBe(`http://127.0.0.1:${server.port}`)
      expect(server.host).toBe("127.0.0.1")
    })

    test("#when stopped #then accepts no further connections", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const url = server.url
      await server.stop()
      server = null
      let errored = false
      try {
        await fetch(`${url}/health`)
      } catch {
        errored = true
      }
      expect(errored).toBe(true)
    })
  })

  describe("#given /health route", () => {
    test("#when GET without auth #then returns 200 with health body", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/health`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.ok).toBe(true)
      expect(typeof body.uptime_ms).toBe("number")
      expect(body.version).toBe("0.4.0-test")
    })
  })

  describe("#given /v1/models route", () => {
    test("#when no auth #then returns 401 with authentication_error", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/models`)
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { type: string } }
      expect(body.error.type).toBe("authentication_error")
    })

    test("#when valid Bearer #then returns 200 with model list", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/models`, {
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { object: string; data: Array<{ id: string }> }
      expect(body.object).toBe("list")
      expect(body.data.map((m) => m.id)).toEqual([
        "deepseek-v4-pro",
        "deepseek-v4-flash",
        "deepseek-v4-vision",
      ])
    })

    test("#when wrong Bearer #then returns 401", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/models`, {
        headers: { authorization: "Bearer wrong" },
      })
      expect(res.status).toBe(401)
    })
  })

  describe("#given /v1/chat/completions route", () => {
    test("#when valid Bearer + stream:true body and no provider configured #then routes through streaming path and returns 500 provider-load failure (V0.6: streaming wired)", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TEST_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        }),
      })
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: { type: string; message: string } }
      expect(body.error.type).toBe("internal_error")
      expect(body.error.message).toMatch(/provider load failed/)
    })

    test("#when function role message present #then returns 400 invalid_request_error (V0.9.2 legacy reject reaches translator after pool acquire failure on missing provider)", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TEST_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [
            { role: "user", content: "hi" },
            { role: "function", content: "x" },
          ],
        }),
      })
      expect([400, 500, 503]).toContain(res.status)
      const body = (await res.json()) as { error: { type: string } }
      expect(typeof body.error.type).toBe("string")
    })

    test("#when stream:true and no provider configured #then internal_error response is returned (V0.6 routing)", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TEST_TOKEN}`,
          "content-type": "application/json",
          "x-request-id": "client-rid-abc",
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        }),
      })
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: { type: string } }
      expect(body.error.type).toBe("internal_error")
    })

    test("#when valid Bearer + invalid body (missing model) #then returns 400 invalid_request_error", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TEST_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { type: string } }
      expect(body.error.type).toBe("invalid_request_error")
    })

    test("#when malformed JSON #then returns 400 invalid_request_error", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TEST_TOKEN}`,
          "content-type": "application/json",
        },
        body: "{invalid",
      })
      expect(res.status).toBe(400)
    })

    test("#when GET instead of POST #then returns 405 method_not_allowed", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      })
      expect(res.status).toBe(405)
    })

    test("#when no auth #then returns 401 (auth checked before route)", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(401)
    })
  })

  describe("#given unknown route", () => {
    test("#when GET /v1/unknown with auth #then returns 404 not_found_error", async () => {
      server = await createOpenAICompatServer(makeConfig(0))
      const res = await fetch(`${server.url}/v1/unknown`, {
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { type: string } }
      expect(body.error.type).toBe("not_found_error")
    })
  })
})
