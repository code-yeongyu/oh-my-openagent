import { onTestFinished } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SecretApi } from "./keystore"
import { createCredentialStore } from "./keystore"

export const grant = {
  accessToken: "synthetic-access-token",
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "synthetic-refresh-token",
  offlineGrant: "synthetic-offline-grant",
  device: { id: "device-1", name: "Test CLI" },
}
export const privateKeys = { signingPrivateKey: "synthetic-signing-private", sealingPrivateKey: "synthetic-sealing-private" }
export const refusal = (code: string, detail?: unknown, status = 400) =>
  Response.json({ error: { code, message: "synthetic refusal", retryable: false, requestId: "test", detail } }, { status })
export const limitDetail = { reason: "device_limit", managementToken: "synthetic-management", used: 2, limit: 2 }

export async function temporaryHome() {
  const home = await mkdtemp(join(tmpdir(), "omo-login-test-"))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  return home
}

export function fakeApi(handler: (request: Request) => Response | Promise<Response>) {
  const noProxy = process.env.NO_PROXY
  process.env.NO_PROXY = "127.0.0.1"
  onTestFinished(() => {
    if (noProxy === undefined) delete process.env.NO_PROXY
    else process.env.NO_PROXY = noProxy
  })
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
  onTestFinished(() => server.stop(true))
  return server.url.origin
}

export function memorySecrets() {
  const values = new Map<string, string>()
  const writes: string[] = []
  const api: SecretApi = {
    get: async ({ service, name }) => values.get(`${service}:${name}`) ?? null,
    set: async ({ service, name, value }) => { writes.push(value); values.set(`${service}:${name}`, value) },
    delete: async ({ service, name }) => values.delete(`${service}:${name}`),
  }
  return { api, values, writes, store: (origin: string) => createCredentialStore(origin, api) }
}

export function clock() {
  let current = Date.parse("2030-01-01T00:00:00Z")
  const delays: number[] = []
  return { now: () => current, delays, sleep: async (ms: number) => { delays.push(ms); current += ms } }
}

export const minted = {
  deviceCode: `dc.${"a".repeat(43)}`, userCode: "BCDF-GHJK", matchingCode: "482 913",
  verificationUri: "https://accounts.omo.dev/device?code=BCDF-GHJK",
  expiresAt: "2030-01-01T00:05:00.000Z", intervalSeconds: 5,
}
