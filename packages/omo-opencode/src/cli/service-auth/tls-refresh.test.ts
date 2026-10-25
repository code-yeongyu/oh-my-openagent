import { expect, onTestFinished, test } from "bun:test"
import { createSession } from "./session"
import { fakeApi, grant, memorySecrets, privateKeys, temporaryHome } from "./test-support"
import { tlsTestCertificate } from "./tls-test-certificate"

test("real Bun TLS certificate rejection preserves a retryable sign-in before any HTTP request", async () => {
  // fakeApi scopes proxy bypass to the loopback test and restores it afterwards.
  fakeApi(() => new Response(null, { status: 204 }))
  const tls = tlsTestCertificate()
  let requests = 0
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0, tls,
    fetch() { requests++; return Response.json(grant) },
  })
  onTestFinished(() => server.stop(true))
  const api = server.url.origin
  const raw: unknown = await fetch(api, { method: "POST", body: "public-probe" }).catch(error => error)
  expect(raw).toBeInstanceOf(Error)
  const code: unknown = raw instanceof Error ? Reflect.get(raw, "code") : undefined
  expect(code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT")
  expect(requests).toBe(0)
  console.log(`Local TLS probe: ${code}; HTTP requests received: ${requests}`)
  const store = memorySecrets().store(api)
  const original = { ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }
  await store.write(original)
  const error: unknown = await createSession({ api, store, home: await temporaryHome() }).accessToken().catch(error => error)
  expect(error).toMatchObject({ notSent: true, retryable: true })
  expect(await store.read()).toEqual(original)
  expect(requests).toBe(0)
})
