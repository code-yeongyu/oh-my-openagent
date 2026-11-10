import { describe, expect, onTestFinished, spyOn, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"

import * as credentialLock from "../../omo-opencode/src/cli/service-auth/credential-lock"
import { CredentialIdentityChanged } from "../../omo-opencode/src/cli/service-auth/keystore"
import { fakeApi, grant, memorySecrets, temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { signedInSyncContext } from "../sync-context"

const keys = () => ({
  signingPrivateKey: generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  sealingPrivateKey: generateKeyPairSync("x25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
})
const identityA = { ...grant, ...keys(), accessToken: "identity-a-access", credentialGeneration: "generation-a" }
const identityB = { ...grant, ...keys(), accessToken: "identity-b-access", device: { id: "device-2", name: "Other CLI" }, credentialGeneration: "generation-b" }

async function harness() {
  const requests: { readonly path: string; readonly authorization: string | null }[] = []
  const api = fakeApi(request => {
    const path = new URL(request.url).pathname
    requests.push({ path, authorization: request.headers.get("authorization") })
    if (path === "/v1/me") return Response.json({ account: { id: "acct" } })
    if (path === "/v1/sync/keys") return Response.json({ entries: [] })
    return new Response("unexpected", { status: 500 })
  })
  const secrets = memorySecrets()
  const store = secrets.store(api)
  await store.write(identityA)
  // The lock would otherwise live under the real home directory; running the action keeps the locked path observable.
  // The action takes the lock lease: the keystore keys its per-section view by it.
  const lease = { handOver: async () => {}, restore: async () => {} }
  const lock = spyOn(credentialLock, "withCredentialLock").mockImplementation(async (_api, action) => action(lease))
  onTestFinished(() => lock.mockRestore())
  const context = await signedInSyncContext({ env: { OMO_SERVICE_API_URL: api }, cwd: await temporaryHome(), store })
  // Building the context records the account under the lock (#12280); only the token path after it must stay lock-free.
  lock.mockClear()
  return { context, store, secrets, requests, lock }
}

describe("signed-in sync context token identity", () => {
  test("a store switched to another identity rejects the next token and sends nothing with its token", async () => {
    const h = await harness()
    await h.store.write(identityB)
    await expect(h.context.chain.listKeys()).rejects.toBeInstanceOf(CredentialIdentityChanged)
    expect(h.requests.map(request => request.path)).toEqual(["/v1/me"])
    expect(h.requests.some(request => request.authorization === `Bearer ${identityB.accessToken}`)).toBe(false)
  })

  // Each clause of `sameIdentity` must reject on its own: exactly one field differs from the captured identity.
  // The store re-mints the generation whenever device or keys change, so a one-field difference is planted in the raw secret instead.
  type Harness = Awaited<ReturnType<typeof harness>>
  const plant = (h: Harness, change: (stored: Record<string, unknown>) => Record<string, unknown>) => {
    const [name, raw] = [...h.secrets.values.entries()][0] ?? []
    if (name === undefined || raw === undefined) throw new Error("the harness stored no credential")
    h.secrets.values.set(name, JSON.stringify({ ...change(JSON.parse(raw) as Record<string, unknown>), accessToken: "changed-access" }))
  }
  const singleFieldChanges: readonly (readonly [string, (stored: Record<string, unknown>) => Record<string, unknown>])[] = [
    ["device id", stored => ({ ...stored, device: { ...identityA.device, id: "device-2" } })],
    ["signing private key", stored => ({ ...stored, signingPrivateKey: keys().signingPrivateKey })],
    ["sealing private key", stored => ({ ...stored, sealingPrivateKey: keys().sealingPrivateKey })],
    ["credentialGeneration", stored => ({ ...stored, credentialGeneration: "generation-b" })],
  ]
  for (const [field, change] of singleFieldChanges) {
    test(`a store whose only difference is the ${field} rejects the next token and sends nothing`, async () => {
      const h = await harness()
      plant(h, change)
      await expect(h.context.chain.listKeys()).rejects.toBeInstanceOf(CredentialIdentityChanged)
      expect(h.requests.map(request => request.path)).toEqual(["/v1/me"])
      expect(h.requests.some(request => request.authorization === "Bearer changed-access")).toBe(false)
    })
  }

  test("the captured identity keeps a valid token lock-free and unrefreshed", async () => {
    const h = await harness()
    await h.context.chain.listKeys()
    await h.context.chain.listKeys()
    expect(h.lock).not.toHaveBeenCalled()
    expect(h.requests).toEqual([
      { path: "/v1/me", authorization: `Bearer ${identityA.accessToken}` },
      { path: "/v1/sync/keys", authorization: `Bearer ${identityA.accessToken}` },
      { path: "/v1/sync/keys", authorization: `Bearer ${identityA.accessToken}` },
    ])
  })
})
