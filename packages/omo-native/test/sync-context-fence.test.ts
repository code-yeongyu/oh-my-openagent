// #12303 review LOW: a pairing waiting in `omo sync enable` must not publish its pin after another
// process (`omo logout`) discarded the keys it holds. The sync context's operation authority runs the
// pin write inside the credential lock, admitted only while the captured credential is still stored.

import { expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"

import { fakeApi, grant, memorySecrets, temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { signedInSyncContext } from "../sync-context"

const der = (key: { export(options: { format: "der"; type: "pkcs8" }): Buffer }) =>
  key.export({ format: "der", type: "pkcs8" }).toString("base64")
const privateKeys = {
  signingPrivateKey: der(generateKeyPairSync("ed25519").privateKey),
  sealingPrivateKey: der(generateKeyPairSync("x25519").privateKey),
}

async function context() {
  const api = fakeApi((request) =>
    new URL(request.url).pathname === "/v1/me"
      ? Response.json({ user: { id: "u" }, account: { id: "acct-fence" } })
      : new Response(null, { status: 404 }),
  )
  const store = memorySecrets().store(api)
  await store.write({ ...grant, ...privateKeys })
  const ctx = await signedInSyncContext({ env: { OMO_SERVICE_API_URL: api }, cwd: await temporaryHome(), store })
  return { ctx, store }
}

test("#given a sync context #when its credential is still stored #then a pin write is admitted inside the credential lock", async () => {
  const { ctx } = await context()
  expect(await ctx.authority.boundary?.(() => "published")).toBe("published")
  expect(ctx.authority.signal.aborted).toBe(false)
})

test("#given a sync context #when another process logged out meanwhile #then no pin write is admitted and the operation is retired", async () => {
  const { ctx, store } = await context()
  await store.clear()
  let published = false
  await expect(
    ctx.authority.boundary?.(() => {
      published = true
    }),
  ).rejects.toThrow("no longer current")
  expect(published).toBe(false)
  expect(ctx.authority.signal.aborted).toBe(true)
  expect(() => ctx.authority.admit(() => undefined)).toThrow()
})

test("#given a sync context #when a different device signed in meanwhile #then no pin write is admitted", async () => {
  const { ctx, store } = await context()
  await store.write({ ...grant, ...privateKeys, device: { id: "device-other", name: "Other CLI" } })
  await expect(ctx.authority.boundary?.(() => undefined)).rejects.toThrow("no longer current")
})
