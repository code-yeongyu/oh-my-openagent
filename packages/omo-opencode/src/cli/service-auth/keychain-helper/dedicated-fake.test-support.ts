import type { HelperAccess } from "./access"
import type { HelperCall, HelperLease, HelperReply } from "./client"
import type { DedicatedStoreState } from "./dedicated-store"
import { fakeKeychain } from "./fake-keychain.test-support"

/**
 * The login keychain and OmO's own keychain behind one fake helper, with the routing the real helper enforces
 * (packages/omo-native/keychain-helper/src/store-select.c, proven against the real helper by
 * keychain-helper-dedicated.test.ts): no store field is refused while active, "omo" is refused while inactive,
 * "omo-migrate" and "login" are the copy steps, and store-erase keeps a sign-in.
 */
export function dedicatedFake(options: { readonly loginLocked?: boolean; readonly state?: DedicatedStoreState } = {}) {
  const login = fakeKeychain()
  const omo = fakeKeychain()
  let state: DedicatedStoreState = options.state ?? "absent"
  const loginLocked = options.loginLocked === true
  const calls: HelperCall[] = []
  const toLogin = (request: HelperCall, lease?: HelperLease): Promise<HelperReply> => {
    if (loginLocked && request.verb !== "remove") return Promise.resolve({ error: "locked" })
    return login.access.kind === "ready" ? login.access.call(request, lease) : Promise.resolve({ error: "store" })
  }
  const toOmo = (request: HelperCall, lease?: HelperLease): Promise<HelperReply> =>
    omo.access.kind === "ready" ? omo.access.call(request, lease) : Promise.resolve({ error: "store" })
  const step = (request: HelperCall): HelperReply => {
    if (request.store !== "omo")
      return { error: "refused", reason: request.store === undefined ? "missing-store" : "store" }
    if (request.verb === "store-create") {
      if (state !== "absent") return { ok: true, skipped: true }
      state = "inactive"
      return { ok: true, created: true }
    }
    if (state === "absent") return { error: "store-refused", reason: "missing" }
    if (request.verb === "store-activate") state = "active"
    else if (request.verb === "store-deactivate") state = "inactive"
    else {
      if (state === "active") return { error: "store-refused", reason: "active" }
      if (omo.items.has(request.account) || omo.items.has(`${request.account}.staging`))
        return { error: "store-refused", reason: "not-empty" }
      omo.items.clear()
      state = "absent"
    }
    return { ok: true }
  }
  const call = async (request: HelperCall, lease?: HelperLease): Promise<HelperReply> => {
    calls.push(request)
    if (request.verb.startsWith("store-")) return step(request)
    if (request.store === undefined)
      return state === "active" ? { error: "store-refused", reason: "store-required" } : toLogin(request, lease)
    if (request.store === "login") return toLogin(request, lease)
    if (state === "absent") return { error: "store-refused", reason: "missing" }
    if (request.store === "omo" && state !== "active") return { error: "store-refused", reason: "store-inactive" }
    return toOmo(request, lease)
  }
  const access: Extract<HelperAccess, { kind: "ready" }> = { kind: "ready", path: "/fake/omo-keychain", call }
  return {
    login,
    omo,
    calls,
    access,
    state: () => state,
  }
}

export const LEASE: HelperLease = { handOver: async () => {}, restore: async () => {} }
