import { afterAll, describe, expect, test } from "bun:test"
import { sign as edSign } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { credentialId } from "../keystore"
import { accountRecordPath, writeAccountRecord } from "./account-record"
import { okpThumbprint, rawEd25519Key } from "./issuer-token"
import { createOmoPresenterAccountAuthority } from "./authority"
import { b64url, ed25519Key, testIssuer, type TestIssuer } from "./presenter-test-issuer"

// Security contract: D11 secret phase design 3.1 (host token mint) and 6.5 (step-up verification), row M-2.

const API = "https://api.example.test"
const ISSUER = `${API}/v1`
const NOW = 1_800_000_000
const homes: string[] = []
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

async function machine(account: string | undefined) {
  const home = mkdtempSync(join(tmpdir(), "omo-secret-phase-"))
  homes.push(home)
  if (account !== undefined)
    await writeAccountRecord(accountRecordPath(home, credentialId(API)), { accountId: account, credentialGeneration: "g1" })
  return home
}

interface IssuerCall {
  readonly path: string
  readonly authorization: string | null
  readonly body: Record<string, unknown>
}

function hostIssuer(iss: TestIssuer, token: (body: Record<string, unknown>) => Promise<Response>) {
  const calls: IssuerCall[] = []
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname
    if (path === "/.well-known/omo-service/jwks.json") return Response.json({ keys: [iss.key] })
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>
    calls.push({ path, authorization: new Headers(init.headers).get("authorization"), body })
    if (path === "/v1/session/secret-host/challenge")
      return Response.json({ nonce: b64url(crypto.getRandomValues(new Uint8Array(32))), expiresAt: new Date(NOW * 1000 + 60_000).toISOString() })
    if (path === "/v1/session/secret-host/token") return token(body)
    return new Response(null, { status: 404 })
  }
  return { fetch, calls }
}

const hostClaims = async (rawHostKey: Uint8Array, overrides: Record<string, unknown> = {}) => ({
  iss: ISSUER, aud: "omo-secret-host", typ: "secret_host", iat: NOW - 5, exp: NOW + 895, jti: "h-1",
  acc: "acc-a", dev: "dev-host", dname: "Host", hin: "hin-1", sid: "sid-1",
  cnf: { jkt: await okpThumbprint(rawHostKey) },
  ...overrides,
})

function mintRequest() {
  const host = ed25519Key()
  const signed: Array<{ issuer: string; nonce: string }> = []
  return {
    host,
    signed,
    request: {
      hostInstance: "hin-1",
      durableSessionId: "sid-1",
      hostKeySpki: host.spki,
      sign: (proof: { issuer: string; nonce: string }) => {
        signed.push(proof)
        return b64url(new Uint8Array(edSign(null, Buffer.from(proof.nonce), host.privateKey)))
      },
    },
  }
}

describe("omo presenter authority: secret host token mint (design 3.1)", () => {
  test("a signed-out host mints nothing: no access token is read, no issuer call, no proof", async () => {
    const iss = await testIssuer()
    const issuer = hostIssuer(iss, async () => new Response(null, { status: 500 }))
    let tokenReads = 0
    const authority = createOmoPresenterAccountAuthority({
      api: API, home: await machine(undefined), fetch: issuer.fetch,
      accessToken: async () => {
        tokenReads += 1
        return "at-unused"
      },
    })
    const { request, signed } = mintRequest()
    await expect(authority.mintSecretHostToken?.(request) ?? Promise.resolve("no method")).rejects.toThrow()
    expect({ tokenReads, issuerCalls: issuer.calls.length, proofs: signed.length }).toEqual({ tokenReads: 0, issuerCalls: 0, proofs: 0 })
  })

  test("mints with the in-process access token and the host-key proof, and returns the issuer's token", async () => {
    const iss = await testIssuer()
    const { request, signed, host } = mintRequest()
    const raw = rawEd25519Key(host.spki) ?? new Uint8Array()
    const hostToken = await iss.sign(await hostClaims(raw))
    const issuer = hostIssuer(iss, async () => Response.json({ hostToken, expiresAt: new Date((NOW + 895) * 1000).toISOString(), keyThumbprint: await okpThumbprint(raw) }))
    const asked: string[] = []
    const authority = createOmoPresenterAccountAuthority({
      api: API, home: await machine("acc-a"), fetch: issuer.fetch, now: () => NOW * 1000,
      accessToken: async (account) => {
        asked.push(account)
        return "at-device"
      },
    })
    expect(await authority.mintSecretHostToken?.(request)).toBe(hostToken)
    expect(asked).toEqual(["acc-a"])
    expect(issuer.calls.map(call => [call.path, call.authorization])).toEqual([
      ["/v1/session/secret-host/challenge", "Bearer at-device"],
      ["/v1/session/secret-host/token", "Bearer at-device"],
    ])
    const [challenge, mint] = issuer.calls
    expect(challenge?.body).toEqual({ publicKey: b64url(raw) })
    expect(signed).toEqual([{ issuer: ISSUER, nonce: String(mint?.body["nonce"]) }])
    expect(mint?.body).toEqual({ publicKey: b64url(raw), nonce: signed[0]?.nonce, hin: "hin-1", sid: "sid-1", signature: expect.any(String) })
  })

  test.each([
    ["bound to another key", async () => ({ cnf: { jkt: await okpThumbprint(ed25519Key().spki.slice(12)) } })],
    ["for another host instance", async () => ({ hin: "hin-2" })],
    ["for another session", async () => ({ sid: "sid-2" })],
    ["of another account", async () => ({ acc: "acc-b" })],
    ["with another audience", async () => ({ aud: "omo-mcp-presenter", typ: "mcp_presenter" })],
  ])("refuses an issuer answer %s", async (_name, override) => {
    const iss = await testIssuer()
    const { request, host } = mintRequest()
    const raw = rawEd25519Key(host.spki) ?? new Uint8Array()
    const hostToken = await iss.sign(await hostClaims(raw, await override()))
    const issuer = hostIssuer(iss, async () => Response.json({ hostToken, expiresAt: new Date((NOW + 895) * 1000).toISOString(), keyThumbprint: "x".repeat(43) }))
    const authority = createOmoPresenterAccountAuthority({
      api: API, home: await machine("acc-a"), fetch: issuer.fetch, now: () => NOW * 1000, accessToken: async () => "at-device",
    })
    await expect(authority.mintSecretHostToken?.(request) ?? Promise.resolve("no method")).rejects.toThrow()
  })

  test("the access token never reaches the environment, argv, the console or an error", async () => {
    const canary = "at-CANARY-7f3c1e9a"
    const iss = await testIssuer()
    const issuer = hostIssuer(iss, async () => new Response(JSON.stringify({ error: { code: "forbidden", message: "nope" } }), { status: 403 }))
    const authority = createOmoPresenterAccountAuthority({
      api: API, home: await machine("acc-a"), fetch: issuer.fetch, now: () => NOW * 1000, accessToken: async () => canary,
    })
    const captured: string[] = []
    const restore = [
      ...(["log", "info", "warn", "error", "debug"] as const).map(level => {
        const original = console[level]
        console[level] = (...args: unknown[]) => captured.push(args.map(String).join(" "))
        return () => { console[level] = original }
      }),
      ...[process.stdout, process.stderr].map(stream => {
        const original = stream.write.bind(stream)
        stream.write = ((chunk: unknown) => { captured.push(String(chunk)); return true }) as typeof stream.write
        return () => { stream.write = original }
      }),
    ]
    let failure = ""
    try {
      await (authority.mintSecretHostToken?.(mintRequest().request) ?? Promise.reject(new Error("no method")))
    } catch (error) {
      failure = error instanceof Error ? `${error.message} ${String(error.stack)} ${JSON.stringify(error)}` : String(error)
    } finally {
      for (const undo of restore) undo()
    }
    expect(issuer.calls.map(call => [call.path, call.authorization])).toEqual([
      ["/v1/session/secret-host/challenge", `Bearer ${canary}`],
      ["/v1/session/secret-host/token", `Bearer ${canary}`],
    ])
    expect(failure).not.toBe("")
    expect([JSON.stringify(process.env), process.argv.join(" "), captured.join("\n"), failure].filter(text => text.includes(canary))).toEqual([])
  })
})

describe("omo presenter authority: step-up token verification (design 6.5)", () => {
  async function stepUp(overrides: Record<string, unknown> = {}, signer?: TestIssuer) {
    const iss = await testIssuer()
    const presenter = ed25519Key()
    const raw = rawEd25519Key(presenter.spki) ?? new Uint8Array()
    const req = b64url(crypto.getRandomValues(new Uint8Array(32)))
    const token = await (signer ?? iss).sign({
      iss: ISSUER, aud: "omo-secret-answer", typ: "secret_answer", iat: NOW - 5, exp: NOW + 100, jti: "s-1",
      acc: "acc-a", dev: "dev-b", hdev: "dev-host", req, uv: true,
      cred: b64url(crypto.getRandomValues(new Uint8Array(32))), cnf: { jkt: await okpThumbprint(raw) },
      ...overrides,
    })
    const authority = createOmoPresenterAccountAuthority({
      api: API, home: await machine("acc-a"), fetch: hostIssuer(iss, async () => new Response(null, { status: 404 })).fetch,
      accessToken: async () => "at-unused",
    })
    return { authority, token, spki: presenter.spki, req }
  }

  test("accepts a step-up token bound to the presenter key and the request", async () => {
    const s = await stepUp()
    expect(await s.authority.verifySecretAnswer?.(s.token, s.spki, s.req, NOW)).toEqual({
      ok: true, stepUp: { acc: "acc-a", dev: "dev-b", jti: "s-1", exp: NOW + 100, hdev: "dev-host" },
    })
  })

  test.each([
    ["a presenter attestation (another aud)", { aud: "omo-mcp-presenter", typ: "mcp_presenter" }, "stepup_audience"],
    ["a host token (another aud)", { aud: "omo-secret-host", typ: "secret_host" }, "stepup_audience"],
    ["a token without user verification", { uv: false }, "stepup_malformed"],
    ["a token living longer than 120 s", { iat: NOW - 5, exp: NOW + 200 }, "stepup_expired"],
    ["an expired token", { iat: NOW - 200, exp: NOW - 90 }, "stepup_expired"],
  ] as const)("refuses %s", async (_name, overrides, reason) => {
    const s = await stepUp(overrides)
    expect(await s.authority.verifySecretAnswer?.(s.token, s.spki, s.req, NOW)).toEqual({ ok: false, reason })
  })

  test("refuses a token bound to another request", async () => {
    const s = await stepUp()
    const other = b64url(crypto.getRandomValues(new Uint8Array(32)))
    expect(await s.authority.verifySecretAnswer?.(s.token, s.spki, other, NOW)).toEqual({ ok: false, reason: "stepup_binding" })
  })

  test("refuses a token issued for another presenter key", async () => {
    const s = await stepUp()
    expect(await s.authority.verifySecretAnswer?.(s.token, ed25519Key().spki, s.req, NOW)).toEqual({ ok: false, reason: "stepup_key_mismatch" })
  })

  test("refuses a token signed by a key the issuer never published", async () => {
    const s = await stepUp({}, await testIssuer("k-stranger"))
    expect(await s.authority.verifySecretAnswer?.(s.token, s.spki, s.req, NOW)).toEqual({ ok: false, reason: "stepup_signature" })
  })
})
