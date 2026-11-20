// #12281, end to end on the chain wire server: a CLI sign-out the service never confirmed leaves the old
// device live, and the next sign-in on that computer owes its revoke (`DELETE /v1/devices/:old` with the new
// device's bearer). That revoke must reach rotation on revoke like any other, so the keyring keeps exactly one
// principal per signed-in device across repeated sign-out and sign-in cycles, and no retired principal opens
// an epoch written after it was revoked.

import { expect, test } from "bun:test"

import { createRejectionCounter } from "../crypto/rejection.ts"
import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import { openAccountChain } from "./account-chain.ts"
import { createAccountHttp } from "./http.ts"
import { principalOf } from "./join.ts"
import { ACCOUNT } from "./testing/genesis-enable.test-support.ts"
import { revokeWorld, type World, type WorldDevice } from "./testing/revoke-world.test-support.ts"

async function chainSeenBy(w: World, device: WorldDevice, token: string) {
  const pin = await loadTrustAnchor(device.pinDir, ACCOUNT)
  if (!pin.ok) throw new Error(`${device.name} holds no pin to walk from`)
  return openAccountChain({
    account: ACCOUNT,
    anchor: pin.anchor,
    keyring: device.keyring,
    rejections: createRejectionCounter(),
    http: createAccountHttp({ baseUrl: w.f.server.url, token: () => token }),
  })
}

test(
  "#given A and B syncing #when B signs out unconfirmed and signs back in twice, each sign-in revoking the device before it #then the keyring holds only A and the current B, and no earlier B opens the newest epoch",
  async () => {
    const w = await revokeWorld()
    try {
      const A = await w.engine(w.a)
      let current = await w.join("b0", 20)
      const retired: WorldDevice[] = []
      for (const [cycle, seed] of [21, 22].entries()) {
        const next = await w.join(`b${cycle + 1}`, seed)
        expect((await w.call(next, "DELETE", `/v1/devices/${current.serviceDeviceId}`)).status).toBe(204)
        expect(w.f.server.freeze.pending).toBe(true)
        await A.write(`written after sign-out ${cycle + 1}`)
        expect((await A.sync.engine.runCycle()).pushed).toBe(true)
        expect(w.f.server.freeze.pending).toBe(false)
        retired.push(current)
        current = next
      }

      const chain = await chainSeenBy(w, w.a, w.a.token)
      const members = [...(chain.state().authority?.members.keys() ?? [])].sort()
      expect(members).toEqual([w.a.keyring.principal().id, current.keyring.principal().id].sort())
      const newest = w.batchEpochs().at(-1) ?? 0
      expect(newest).toBe(3)
      for (const old of retired) {
        const leaked = w.f.server.tokenFor(principalOf(old.keyring), `${old.serviceDeviceId}-copy`)
        expect(await (await chainSeenBy(w, old, leaked)).epochKey(newest)).toBeNull()
      }
    } finally {
      await w.close()
    }
  },
)
