// Protocol contract (#13691): the `omo sync` CLI context reads the account through syncRequestHeaders like every
// other sync client, so a service that floors the route on the phrase capability still answers it.

import { expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"

import { SYNC_CAPABILITIES, SYNC_CONTRACT_VERSION } from "../../memory-core/src/sync/contract-version"
import { fakeApi, grant, memorySecrets, temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { signedInSyncContext } from "../sync-context"

const der = (key: { export(options: { format: "der"; type: "pkcs8" }): Buffer }) =>
  key.export({ format: "der", type: "pkcs8" }).toString("base64")

test("#given a service that floors the account read on the phrase capability #when omo sync opens its context #then the read carries the contract headers and is answered", async () => {
  const seen: { readonly version: string | null; readonly capabilities: string | null }[] = []
  const api = fakeApi((request) => {
    if (new URL(request.url).pathname !== "/v1/me") return new Response(null, { status: 404 })
    const capabilities = request.headers.get("omo-sync-capabilities")
    seen.push({ version: request.headers.get("omo-contract-version"), capabilities })
    return capabilities === SYNC_CAPABILITIES
      ? Response.json({ user: { id: "u" }, account: { id: "acct-floor" } })
      : Response.json({ error: { code: "client_update_required" } }, { status: 426 })
  })
  const store = memorySecrets().store(api)
  await store.write({
    ...grant,
    signingPrivateKey: der(generateKeyPairSync("ed25519").privateKey),
    sealingPrivateKey: der(generateKeyPairSync("x25519").privateKey),
  })

  await signedInSyncContext({ env: { OMO_SERVICE_API_URL: api }, cwd: await temporaryHome(), store })

  expect(seen).toEqual([{ version: SYNC_CONTRACT_VERSION, capabilities: SYNC_CAPABILITIES }])
})
