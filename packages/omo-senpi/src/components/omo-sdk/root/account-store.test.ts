import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type StoreDependencies, storePort } from "@oh-my-opencode/account-core/calls/store"
import { dedicatedFake } from "@oh-my-opencode/account-core/keychain-helper/dedicated-fake.test-support"
import { A, API } from "@oh-my-opencode/account-core/keychain-helper/fake-keychain.test-support"
import { assembleOmoSdk } from "../assembly"

// account.store.status, enable and disable on the root (first-party design 6.4, slice A1b): each answers the typed
// fields its verb prints, refuses as data, answers desktop_sign_in under a desktop launch before touching the helper,
// and never returns the stored sign-in (security design 6).

const CANARY = "store-canary-signed-in-value"
const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function rootWith(store: Partial<StoreDependencies>, desktopLaunch = false) {
  const home = mkdtempSync(join(tmpdir(), "omo-sdk-store-"))
  homes.push(home)
  const fake = dedicatedFake()
  fake.login.put(A, CANARY, "helper")
  const sdk = assembleOmoSdk(
    {
      principal: { kind: "person", uid: 501 },
      env: { OMO_SERVICE_API_URL: API },
      cwd: home,
      ports: {
        desktopLaunch: () => desktopLaunch,
        accountStore: storePort({
          api: API,
          platform: "darwin",
          state: fake.state,
          access: async () => fake.access,
          home,
          ...store,
        }),
      },
    },
    {},
  )
  return { sdk, fake }
}

describe("account.store on the root", () => {
  test("#given a signed-in login keychain #when enabled then disabled #then each answers its verb's fields and no stored value", async () => {
    const { sdk, fake } = rootWith({})
    const enabled = await sdk.account.store.enable()
    expect(enabled).toEqual({
      kind: "ok",
      value: { store: "omo", created: true, moved: "copied", loginLeftover: false },
    })
    expect(await sdk.account.store.status()).toMatchObject({ kind: "ok", value: { store: "omo", state: "active" } })
    const disabled = await sdk.account.store.disable()
    expect(disabled).toEqual({ kind: "ok", value: { store: "login", moved: "copied", erased: true } })
    expect(fake.login.items.get(A)?.value).toBe(CANARY)
    expect(JSON.stringify([enabled, disabled])).not.toContain(CANARY)
  })

  test("#given a platform other than macOS #when enabled #then it refuses as unsupported and asks the helper nothing", async () => {
    const { sdk, fake } = rootWith({ platform: "linux" })
    expect(await sdk.account.store.enable()).toMatchObject({
      kind: "error",
      error: { code: "unsupported", details: { reason: "macos_only" } },
    })
    expect(await sdk.account.store.status()).toMatchObject({ kind: "ok", value: { store: "login", state: "absent" } })
    expect(fake.calls).toEqual([])
  })

  test("#given no signed keychain helper #when disabled #then it refuses as credential_store_unavailable", async () => {
    const { sdk } = rootWith({ access: async () => ({ kind: "missing" }) })
    expect(await sdk.account.store.disable({ discard: true })).toMatchObject({
      kind: "error",
      error: { code: "credential_store_unavailable", details: { reason: "helper_unavailable" } },
    })
  })

  test("#given an active store still holding a sign-in #when disabled with discard #then the helper's refusal comes back as data, naming the store", async () => {
    const { sdk } = rootWith({})
    await sdk.account.store.enable()
    const refused = await sdk.account.store.disable({ discard: true })
    expect(refused).toMatchObject({
      kind: "error",
      error: { code: "credential_store_unavailable", details: { reason: "switch_failed", store: "omo" } },
    })
    expect(JSON.stringify(refused)).not.toContain(CANARY)
  })

  test("#given a desktop launch #when any store call runs #then it answers desktop_sign_in before the helper is asked", async () => {
    const { sdk, fake } = rootWith({}, true)
    for (const answer of [
      await sdk.account.store.status(),
      await sdk.account.store.enable(),
      await sdk.account.store.disable(),
    ])
      expect(answer).toMatchObject({ kind: "error", error: { code: "desktop_sign_in" } })
    expect(fake.calls).toEqual([])
  })
})
