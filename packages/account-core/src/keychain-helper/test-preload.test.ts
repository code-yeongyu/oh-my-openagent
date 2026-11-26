import { describe, expect, test } from "bun:test"

import { storeEnable, storeSwitchPort } from "../calls/store"
import { resolveHelperAccess } from "./access"
import { spawnDetachedHelper } from "./client"
import { helperAccess } from "./darwin-backend"
import { keychainProcessState } from "./process-state"
import { KeychainHelperUnderTestPreload, underTestPreload } from "./test-preload"

// The repository's one guard on the signed keychain helper (security owner's order on the 2026-11-26 incident): under the
// test preload, any port that would reach the real helper is refused by name before anything is located, pinned,
// verified or spawned; a port that injects a fake spawner passes. The verifier and pin below record whether the
// resolution got that far.

function reached() {
  const touched: string[] = []
  return {
    touched,
    verify: async () => {
      touched.push("verify")
      return "valid" as const
    },
    pin: async () => {
      touched.push("pin")
      return { kind: "pinned" as const, path: "/pinned/omo-keychain" }
    },
  }
}

describe("the keychain helper under the test preload", () => {
  test("#given this test process #then it runs under the preload (the guard's precondition)", () => {
    expect(underTestPreload()).toBe(true)
  })

  test("#given a new port wired to the real helper spawner #then it is refused by name and nothing is touched", async () => {
    const { touched, verify, pin } = reached()
    const refused = resolveHelperAccess(["/opt/omo/omo-keychain"], { port: "a throwaway port", verify, pin })
    await expect(refused).rejects.toBeInstanceOf(KeychainHelperUnderTestPreload)
    await expect(refused).rejects.toThrow("a throwaway port")
    expect(touched).toEqual([])
  })

  test("#given a port that passes the real spawner by name #then it is refused like one that passes none", async () => {
    const { touched, verify, pin } = reached()
    const refused = resolveHelperAccess(["/opt/omo/omo-keychain"], {
      port: "a port naming the real spawner",
      verify,
      pin,
      spawn: spawnDetachedHelper,
    })
    await expect(refused).rejects.toBeInstanceOf(KeychainHelperUnderTestPreload)
    expect(touched).toEqual([])
  })

  test("#given a port that injects a fake spawner #then it resolves", async () => {
    const { touched, verify, pin } = reached()
    const access = await resolveHelperAccess(["/opt/omo/omo-keychain"], {
      port: "a test port",
      verify,
      pin,
      spawn: () => {
        throw new Error("never spawned in this test")
      },
    })
    expect({ kind: access.kind, touched }).toEqual({ kind: "ready", touched: ["verify", "pin"] })
  })

  test("#given the store switch's real default access #when enabled under the preload #then the switch is refused, naming account.store", async () => {
    keychainProcessState().helperAccess = undefined
    const port = storeSwitchPort({
      api: "https://accounts.example.test",
      platform: "darwin",
      state: () => "absent",
      access: () => helperAccess("account.store"),
    })
    await expect(storeEnable(port)).rejects.toThrow("account.store reached for the signed keychain helper")
  })
})
