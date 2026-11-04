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
  const store = memorySecrets().store(api)
  await store.write(identityA)
  // The lock would otherwise live under the real home directory; running the action keeps the locked path observable.
  const lock = spyOn(credentialLock, "withCredentialLock").mockImplementation(async (_api, action) => action())
  onTestFinished(() => lock.mockRestore())
  const context = await signedInSyncContext({ env: { OMO_SERVICE_API_URL: api }, cwd: await temporaryHome(), store })
  return { context, store, requests, lock }
}

describe("signed-in sync context token identity", () => {
  test("a store switched to another identity rejects the next token and sends nothing with its token", async () => {
    const h = await harness()
    await h.store.write(identityB)
    await expect(h.context.chain.listKeys()).rejects.toBeInstanceOf(CredentialIdentityChanged)
    expect(h.requests.map(request => request.path)).toEqual(["/v1/me"])
    expect(h.requests.some(request => request.authorization === `Bearer ${identityB.accessToken}`)).toBe(false)
  })

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
