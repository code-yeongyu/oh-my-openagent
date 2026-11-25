import { describe, expect, test } from "bun:test"

import { InvalidCredentialState } from "@oh-my-opencode/account-core/keystore"
import type { AccountSessionPort } from "../access"
import { assembleOmoSdk } from "../assembly"

// account.signOut, account.forget and account.signInCheck on the root (first-party design 6.4, slice A1b): forget acts
// on this device only, an empty or another device's id clears nothing, an unreadable credential under a named device
// is refused, and every call answers desktop_sign_in under a desktop launch before the session is touched.

const current = { device: { id: "dev-1", name: "laptop" } }

function rootWith(options: { readonly stored?: unknown; readonly unreadable?: boolean; readonly desktop?: boolean }) {
  const effects: string[] = []
  const account: AccountSessionPort = {
    session: {
      logout: async () => {
        effects.push("logout")
        return true
      },
      forget: async () => {
        effects.push("forget")
      },
      update: (async (change: (value: unknown) => Promise<unknown>) => {
        if (options.unreadable === true) throw new InvalidCredentialState("synthetic unreadable credential")
        effects.push("update")
        return change(options.stored ?? null)
      }) as AccountSessionPort["session"]["update"],
      discard: async () => {
        effects.push("discard")
      },
    },
    store: {
      clear: async () => {
        effects.push("clear")
      },
    },
    deviceService: {
      forget: async () => {
        effects.push("deviceService.forget")
      },
    },
  }
  const sdk = assembleOmoSdk(
    {
      principal: { kind: "person", uid: 501 },
      env: { OMO_SERVICE_API_URL: "https://api.example.test" },
      cwd: "/work",
      ports: { desktopLaunch: () => options.desktop === true, accountSession: account },
    },
    {},
  )
  return { sdk, effects }
}

describe("account.signOut, forget and signInCheck on the root", () => {
  test("#given a signed-in device #when signed out #then it answers whether the revoke was confirmed", async () => {
    const { sdk, effects } = rootWith({ stored: current })
    expect(await sdk.account.signOut()).toEqual({ kind: "ok", value: { signedOut: true, revoked: true } })
    expect(effects).toEqual(["logout"])
  })

  test("#given no device #when forgotten #then this device's sign-in is forgotten", async () => {
    const { sdk, effects } = rootWith({ stored: current })
    expect(await sdk.account.forget()).toEqual({ kind: "ok", value: { forgotten: true } })
    expect(effects).toEqual(["forget"])
  })

  test("#given this device's id #when forgotten #then its keys are discarded, the store cleared and the device service told", async () => {
    const { sdk, effects } = rootWith({ stored: current })
    expect(await sdk.account.forget({ device: "dev-1" })).toEqual({ kind: "ok", value: { forgotten: true } })
    expect(effects).toEqual(["update", "discard", "clear", "deviceService.forget"])
  })

  test("#given another device's id #when forgotten #then it refuses and clears nothing", async () => {
    const { sdk, effects } = rootWith({ stored: current })
    expect(await sdk.account.forget({ device: "dev-2" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments", details: { device: { id: "dev-1", name: "laptop" } } },
    })
    expect(effects).toEqual(["update"])
  })

  test("#given an empty device id #when forgotten #then it refuses before the session is touched", async () => {
    const { sdk, effects } = rootWith({ stored: current })
    expect(await sdk.account.forget({ device: "" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(effects).toEqual([])
  })

  test("#given an unreadable credential #when a named device is forgotten #then it refuses with the store unavailable", async () => {
    const { sdk, effects } = rootWith({ unreadable: true })
    expect(await sdk.account.forget({ device: "dev-1" })).toMatchObject({
      kind: "error",
      error: { code: "credential_store_unavailable", details: { reason: "unreadable_credential" } },
    })
    expect(effects).toEqual([])
  })

  test("#given a desktop launch #when signOut or forget runs #then it answers desktop_sign_in and touches nothing", async () => {
    const { sdk, effects } = rootWith({ stored: current, desktop: true })
    expect(await sdk.account.signOut()).toMatchObject({ kind: "error", error: { code: "desktop_sign_in" } })
    expect(await sdk.account.forget()).toMatchObject({ kind: "error", error: { code: "desktop_sign_in" } })
    expect(effects).toEqual([])
  })

  test("#given any root #when signInCheck runs #then it answers ready and touches nothing", async () => {
    const { sdk, effects } = rootWith({ desktop: true })
    expect(await sdk.account.signInCheck()).toEqual({ kind: "ok", value: { ready: true } })
    expect(effects).toEqual([])
  })
})
