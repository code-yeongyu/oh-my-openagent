import { afterEach, expect, test } from "bun:test"
import { disposeSyncRpcFixtures, owner, setup } from "./sync-rpc-test-support"
import { AccountHttpError } from "../../../../memory-core/src/sync/account/http"
afterEach(disposeSyncRpcFixtures)

const GENERIC = "The service refused this sync request."

// #12123: the service's own code decides what the settings page can offer; its message text never crosses.
const KNOWN = [
  ["not_available", 403, "Memory sync isn't available yet. Your memory stays on this device until it launches."],
  ["entitlement_required", 403, "Memory sync isn't included in this account's plan."],
  ["access_not_open", 403, "OmO isn't open to this account yet."],
  ["device_revoked", 401, "This device was removed from your account. Sign in again to sync."],
  ["reauth_required", 401, "Your sign-in has expired. Sign in again to sync."],
  ["account_deleted", 410, "This account was deleted."],
  ["client_update_required", 426, "Update OmO to keep syncing."],
] as const

for (const [code, status, reason] of KNOWN) {
  test(`#given the service refuses enable with ${code} #when enable settles #then it reports that code with its own copy`, async () => {
    const f = await setup()
    f.runtime.enableSync = async () => { throw new AccountHttpError(code, status) }
    const result = await f.call("enable", owner("a").context)
    expect(result).toEqual({ kind: "refused", reason, code })
  })

  test(`#given the service refuses the pending read with ${code} #when pending is read #then it reports that code with its own copy`, async () => {
    const f = await setup()
    const original = f.account.forOperation
    f.account.forOperation = async (authority) => {
      const ports = await original(authority)
      return { ...ports, pairing: { ...ports.pairing, listPending: async () => { throw new AccountHttpError(code, status) } } }
    }
    expect(await f.call("pending", owner("a").context)).toEqual({ kind: "refused", reason, code })
  })
}

test("#given a service code outside the contract #when enable settles #then the generic refusal carries no code or service text", async () => {
  const f = await setup()
  f.runtime.enableSync = async () => { throw new AccountHttpError("private-detail", 403) }
  const result = await f.call("enable", owner("a").context)
  expect(result).toEqual({ kind: "refused", reason: GENERIC })
  expect(JSON.stringify(result)).not.toContain("private-detail")
})
