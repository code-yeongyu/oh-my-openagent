import { describe, expect, test } from "bun:test"
import {
  CredentialStoreError,
  createCredentialStore,
  DedicatedStoreError,
  INTERACTIVE_READ_WAIT,
  KeychainItemNotOwnedError,
  type SecretApi,
} from "../keystore"
import type { HelperAccess } from "./access"
import { A, API, credentials } from "./fake-keychain.test-support"
import { dedicatedFake } from "./dedicated-fake.test-support"

// #13116 design r2 finding 1: with OmO's own keychain active nothing reaches the login keychain, through the helper or
// around it; with it inactive the helper requests are exactly today's.
const untouchable: SecretApi & { touched: number } = {
  touched: 0,
  get: async () => {
    untouchable.touched++
    return null
  },
  set: async () => {
    untouchable.touched++
  },
  delete: async () => {
    untouchable.touched++
    return false
  },
}

const storeOn = (access: () => Promise<HelperAccess>, dedicated: () => boolean, secrets: SecretApi = untouchable) =>
  createCredentialStore(API, {
    secrets,
    platform: "darwin",
    lockProbe: async () => "unlocked",
    notice: () => {},
    wait: INTERACTIVE_READ_WAIT,
    keychainHelper: { access, silently: (run) => run(), ownerMarker: async () => "absent", dedicatedStore: dedicated },
  })

describe("sign-in storage while OmO's own keychain is active (#13116)", () => {
  test("#given an active store #when the sign-in is written, read and cleared #then every helper call names it and the login keychain is never touched", async () => {
    const fake = dedicatedFake({ state: "active" })
    untouchable.touched = 0
    const store = storeOn(
      async () => fake.access,
      () => true,
    )
    await store.write(credentials, "fresh-sign-in")
    expect(fake.omo.items.has(A)).toBe(true)
    expect((await store.read())?.device.id).toBe(credentials.device.id)
    await store.clear()
    expect(fake.omo.items.has(A)).toBe(false)
    expect(fake.login.items.size).toBe(0)
    expect(fake.calls.every((call) => call.store === "omo")).toBe(true)
    expect(untouchable.touched).toBe(0)
  })

  test("#given an active store #when the helper is missing #then reads and writes fail as a store error and never fall back to Bun.secrets", async () => {
    untouchable.touched = 0
    const store = storeOn(
      async () => ({ kind: "missing" }),
      () => true,
    )
    await expect(store.read()).rejects.toThrow(/keychain helper is missing/)
    await expect(store.write(credentials)).rejects.toBeInstanceOf(CredentialStoreError)
    expect(untouchable.touched).toBe(0)
  })

  test("#given a reader that chose the store just before it was turned off #when the helper says store-inactive #then it is a store error, never signed out", async () => {
    const fake = dedicatedFake({ state: "inactive" })
    const store = storeOn(
      async () => fake.access,
      () => true,
    )
    await expect(store.read()).rejects.toThrow(/turned off while omo was using it/)
  })

  test("#given an older helper that refuses the store field #when an active store is read #then the error says to update omo", async () => {
    const old: HelperAccess = {
      kind: "ready",
      path: "/fake/old",
      call: async () => ({ error: "refused", reason: "unknown-key" }),
    }
    const store = storeOn(
      async () => old,
      () => true,
    )
    await expect(store.read()).rejects.toThrow(/older than this omo/)
  })

  test("#given an item in OmO's keychain the helper cannot read #when read and then signed in fresh #then row 8b: signed out, moved aside, new sign-in lands, nothing read another way", async () => {
    const fake = dedicatedFake({ state: "active" })
    fake.omo.put(A, "dummy-unreadable", "other-app", "other")
    untouchable.touched = 0
    const store = storeOn(
      async () => fake.access,
      () => true,
    )
    expect(await store.read()).toBeNull()
    await store.write(credentials, "fresh-sign-in")
    expect(fake.omo.items.get(`${A}.old`)?.value).toBe("dummy-unreadable")
    expect((await store.read())?.device.id).toBe(credentials.device.id)
    expect(fake.calls.every((call) => call.store === "omo")).toBe(true)
    expect(fake.calls.some((call) => call.verb === "approve")).toBe(false)
    expect(untouchable.touched).toBe(0)
  })

  test("#given an item in OmO's keychain another program owns #when the sign-in is cleared #then it fails as an OmO-keychain store error, never the login-keychain not-owned error", async () => {
    const fake = dedicatedFake({ state: "active" })
    fake.omo.put(A, "dummy-unreadable", "other-app", "other")
    untouchable.touched = 0
    const store = storeOn(
      async () => fake.access,
      () => true,
    )
    const failure = await store.clear().then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(DedicatedStoreError)
    expect(failure).not.toBeInstanceOf(KeychainItemNotOwnedError)
    expect(untouchable.touched).toBe(0)
  })

  test("#given an inactive store #when the sign-in is written and read #then no helper call carries a store field", async () => {
    const fake = dedicatedFake()
    const store = storeOn(
      async () => fake.access,
      () => false,
    )
    await store.write(credentials, "fresh-sign-in")
    expect((await store.read())?.device.id).toBe(credentials.device.id)
    expect(fake.login.items.has(A)).toBe(true)
    expect(fake.calls.every((call) => !("store" in call))).toBe(true)
  })
})
