import { afterAll, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { credentialId } from "../keystore"
import { signedOutMarkerPath, writeSignedOutMarker } from "../signed-out-marker"
import { accountRecordPath, writeAccountRecord } from "./account-record"
import { createOmoPresenterAccountAuthority } from "./authority"
import { okpThumbprint, rawEd25519Key } from "./issuer-token"

const API = "https://api.example.test"
const homes: string[] = []
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url")
const text = (value: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(value)))

async function issuer(kid = "k1") {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
  const key = { kty: "EC", crv: "P-256", x: String(jwk.x), y: String(jwk.y), kid }
  const sign = async (claims: Record<string, unknown>): Promise<string> => {
    const head = `${text({ alg: "ES256", kid, typ: "JWT" })}.${text(claims)}`
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(head))
    return `${head}.${b64url(new Uint8Array(signature))}`
  }
  const fetchJwks = async (url: string): Promise<Response> => {
    expect(url).toBe(`${API}/.well-known/omo-service/jwks.json`)
    return Response.json({ keys: [key] })
  }
  return { sign, fetchJwks }
}

function presenterKey() {
  const { publicKey } = generateKeyPairSync("ed25519")
  return new Uint8Array(publicKey.export({ format: "der", type: "spki" }))
}

function machine() {
  const home = mkdtempSync(join(tmpdir(), "omo-presenter-authority-"))
  homes.push(home)
  const credential = credentialId(API)
  return { home, record: accountRecordPath(home, credential), marker: signedOutMarkerPath(home, credential) }
}

const NOW = 1_800_000_000
const claims = async (spki: Uint8Array, overrides: Record<string, unknown> = {}) => ({
  iss: `${API}/v1`, aud: "omo-mcp-presenter", typ: "mcp_presenter", iat: NOW - 10, exp: NOW + 800,
  jti: "j-1", acc: "acc-a", dev: "dev-1", dname: "Laptop",
  cnf: { jkt: await okpThumbprint(rawEd25519Key(spki) ?? new Uint8Array()) },
  ...overrides,
})

function nextChange(authority: ReturnType<typeof createOmoPresenterAccountAuthority>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop()
      reject(new Error("no account change within 5 s"))
    }, 5_000)
    const stop = authority.onAccountChange(() => {
      clearTimeout(timer)
      stop()
      resolve()
    })
  })
}

describe("omo presenter account authority: host account", () => {
  test("a machine with no account record is signed out", () => {
    const m = machine()
    const authority = createOmoPresenterAccountAuthority({ api: API, home: m.home })
    expect(authority.hostAccount()).toBeUndefined()
  })

  test("the account record names the host account, and an omo logout marker overrides it", async () => {
    const m = machine()
    await writeAccountRecord(m.record, { accountId: "acc-a", credentialGeneration: "g1" })
    const authority = createOmoPresenterAccountAuthority({ api: API, home: m.home })
    expect(authority.hostAccount()).toBe("acc-a")
    await writeSignedOutMarker(m.marker, "dev-1")
    expect(authority.hostAccount()).toBeUndefined()
  })
})

describe("omo presenter account authority: change events", () => {
  test("an omo logout marker fires onAccountChange", async () => {
    const m = machine()
    await writeAccountRecord(m.record, { accountId: "acc-a", credentialGeneration: "g1" })
    const authority = createOmoPresenterAccountAuthority({ api: API, home: m.home })
    const changed = nextChange(authority)
    await writeSignedOutMarker(m.marker, "dev-1")
    await changed
    expect(authority.hostAccount()).toBeUndefined()
  })

  test("an account switch fires onAccountChange", async () => {
    const m = machine()
    await writeAccountRecord(m.record, { accountId: "acc-a", credentialGeneration: "g1" })
    const authority = createOmoPresenterAccountAuthority({ api: API, home: m.home })
    const changed = nextChange(authority)
    await writeAccountRecord(m.record, { accountId: "acc-b", credentialGeneration: "g2" })
    await changed
    expect(authority.hostAccount()).toBe("acc-b")
  })

  test("a rewrite for the same account does not fire, and a later switch still does", async () => {
    const m = machine()
    await writeAccountRecord(m.record, { accountId: "acc-a", credentialGeneration: "g1" })
    const authority = createOmoPresenterAccountAuthority({ api: API, home: m.home })
    const fired: string[] = []
    const stop = authority.onAccountChange(() => fired.push(String(authority.hostAccount())))
    const switched = nextChange(authority)
    await writeAccountRecord(m.record, { accountId: "acc-a", credentialGeneration: "g2" })
    await writeAccountRecord(m.record, { accountId: "acc-b", credentialGeneration: "g3" })
    await switched
    stop()
    expect(fired).toEqual(["acc-b"])
  })
})

describe("omo presenter account authority: verify", () => {
  test("accepts a presenter attestation for the key that proves it", async () => {
    const m = machine()
    const iss = await issuer()
    const spki = presenterKey()
    const authority = createOmoPresenterAccountAuthority({ api: API, home: m.home, fetch: iss.fetchJwks })
    const result = await authority.verify(await iss.sign(await claims(spki)), spki, NOW)
    expect(result).toEqual({ ok: true, attestation: { acc: "acc-a", dev: "dev-1", dname: "Laptop", exp: NOW + 800, jti: "j-1" } })
  })

  test.each([
    ["a relay token (wrong aud)", { aud: "omo-relay", typ: "relay" }, "attestation_audience"],
    ["a wrong typ", { typ: "relay" }, "attestation_audience"],
    ["an expired token", { iat: NOW - 900, exp: NOW - 100 }, "attestation_expired"],
    ["a token from another issuer", { iss: "https://evil.example/v1" }, "attestation_signature"],
    ["a dname with a control character", { dname: "a\u0007b" }, "attestation_malformed"],
  ] as const)("refuses %s", async (_name, overrides, reason) => {
    const m = machine()
    const iss = await issuer()
    const spki = presenterKey()
    const authority = createOmoPresenterAccountAuthority({ api: API, home: m.home, fetch: iss.fetchJwks })
    expect(await authority.verify(await iss.sign(await claims(spki, overrides)), spki, NOW)).toEqual({ ok: false, reason })
  })

  test("refuses a token issued for another presenter key", async () => {
    const m = machine()
    const iss = await issuer()
    const authority = createOmoPresenterAccountAuthority({ api: API, home: m.home, fetch: iss.fetchJwks })
    const token = await iss.sign(await claims(presenterKey()))
    expect(await authority.verify(token, presenterKey(), NOW)).toEqual({ ok: false, reason: "attestation_key_mismatch" })
  })

  test("refuses a signature by a key the issuer never published", async () => {
    const m = machine()
    const published = await issuer("k1")
    const stranger = await issuer("k2")
    const spki = presenterKey()
    const authority = createOmoPresenterAccountAuthority({ api: API, home: m.home, fetch: published.fetchJwks })
    expect(await authority.verify(await stranger.sign(await claims(spki)), spki, NOW)).toEqual({ ok: false, reason: "attestation_signature" })
  })
})
