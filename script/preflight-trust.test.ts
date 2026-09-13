import { expect, test } from "bun:test"
import { verifyPublisher, requestWithRetry } from "./preflight-trust.mjs"
import { createServer } from "node:http"
import { once } from "node:events"

test("the real HTTP adapter retries the same POST with its authorization and body intact", async () => {
  const requests: Array<{ method?: string; authorization?: string; body: string }> = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({ method: request.method, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString() })
    response.writeHead(requests.length === 1 ? 503 : 201, { "Content-Type": "application/json" })
    response.end(requests.length === 1 ? '{"error":"propagating"}' : '{"token":"issued-secret"}')
  })
  const listening = once(server, "listening", { signal: AbortSignal.timeout(5000) })
  server.listen(0, "127.0.0.1")
  await listening
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing TCP address")
    const waits: number[] = []
    const response = await requestWithRetry("lazycodex-ai", `http://127.0.0.1:${address.port}/exchange`, {
      method: "POST", headers: { Authorization: "Bearer fixture-token" }, body: "{}",
    }, { sleep: async (ms: number) => { waits.push(ms) }, log: () => {} })
    expect(response.status).toBe(201)
    await response.body?.cancel()
    expect(requests).toEqual(Array.from({ length: 2 }, () => ({ method: "POST", authorization: "Bearer fixture-token", body: "{}" })))
    expect(waits).toEqual([1000])
  } finally {
    const closed = once(server, "close", { signal: AbortSignal.timeout(5000) })
    server.close()
    server.closeAllConnections()
    await closed
  }
})

function fixture(responses: Array<Response | Error>) {
  const waits: number[] = []
  const logs: string[] = []
  let calls = 0
  return {
    waits, logs,
    get calls() { return calls },
    options: {
      request: async () => {
        const value = responses[calls++]
        if (value instanceof Error) throw value
        if (!value) throw new Error("Unexpected request")
        return value
      },
      sleep: async (ms: number) => { waits.push(ms) },
      log: (line: string) => { logs.push(line) },
    },
  }
}

test("TLS failures, rate limits and server errors recover automatically with bounded backoff", async () => {
  const f = fixture([Object.assign(new Error("TLS handshake failed"), { code: "ECONNRESET" }), new Response("rate limited", { status: 429 }), new Response("unavailable", { status: 503 }), new Response('{"token":"secret"}', { status: 201 })])
  await verifyPublisher("oh-my-opencode-windows-x64", "oidc-secret", f.options)
  expect(f.calls).toBe(4)
  expect(f.waits).toEqual([1000, 2000, 4000])
  expect(f.logs[0]).toContain("oh-my-opencode-windows-x64")
  expect(f.logs[0]).toContain("ECONNRESET")
  expect(f.logs.join("\n")).not.toContain("secret")
})

test("ambiguous 404 propagation retries rather than claiming missing configuration", async () => {
  const f = fixture([new Response("not found", { status: 404 }), new Response("{}", { status: 200 })])
  await verifyPublisher("lazycodex-ai", "token", f.options)
  expect(f.calls).toBe(2)
})

for (const status of [400, 401, 403]) {
  test(`definitive HTTP ${status} fails fast with package/status and configuration guidance`, async () => {
    const f = fixture([new Response('{"error":"publisher mismatch"}', { status })])
    await expect(verifyPublisher("omo-ai", "token", f.options)).rejects.toThrow(`omo-ai HTTP ${status}`)
    expect(f.calls).toBe(1)
    expect(f.waits).toEqual([])
    expect(f.logs[0]).toContain(`omo-ai HTTP ${status}`)
    expect(f.logs.join("\n")).toContain("https://www.npmjs.com/package/omo-ai/access")
  })
}

test("exhaustion surfaces actual npm status/body without misleading configuration guidance", async () => {
  const f = fixture(Array.from({ length: 6 }, () => new Response('{"error":"registry unavailable"}', { status: 503 })))
  await expect(verifyPublisher("lazycodex-ai", "token", f.options)).rejects.toThrow("lazycodex-ai HTTP 503")
  expect(f.calls).toBe(6)
  expect(f.waits).toEqual([1000, 2000, 4000, 8000, 16000])
  expect(f.logs[0]).toContain("lazycodex-ai HTTP 503")
  expect(f.logs.join("\n")).toContain("registry unavailable")
  expect(f.logs.join("\n")).not.toContain("/access")
})

test("an explicit missing publisher mapping fails fast even on HTTP 404", async () => {
  const f = fixture([new Response('{"error":"No trusted publisher configured"}', { status: 404 })])
  await expect(verifyPublisher("lazycodex-ai", "token", f.options)).rejects.toThrow("lazycodex-ai HTTP 404")
  expect(f.calls).toBe(1)
  expect(f.logs.join("\n")).toContain("/access")
})

test("error diagnostics redact credential fields and JWTs", async () => {
  const f = fixture([new Response('{"error":"denied","token":"private-token","value":"private-oidc"}', { status: 403 })])
  await expect(verifyPublisher("omo-ai", "token", f.options)).rejects.toThrow("HTTP 403")
  expect(f.logs.join("\n")).not.toContain("private-")
})

test("unknown HTTP failures fail closed and Retry-After is capped", async () => {
  const f = fixture([new Response("busy", { status: 429, headers: { "retry-after": "99999" } }), new Response("bad redirect", { status: 302 })])
  await expect(requestWithRetry("npm", "https://registry.npmjs.org", {}, f.options)).rejects.toThrow("HTTP 302")
  expect(f.waits).toEqual([30000])
})
