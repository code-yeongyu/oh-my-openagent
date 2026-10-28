import { afterEach, describe, expect, test } from "bun:test"
import type { HelperAccess } from "./access"
import { sharedHelperAccess } from "./darwin-backend"
import { keychainProcessState } from "./process-state"
import { bindKeychainHelper } from "./store-binding"

const isDarwin = process.platform === "darwin"
const ready: HelperAccess = { kind: "ready", path: "/fake/omo-keychain", call: async () => ({ missing: true }) }

afterEach(() => {
  keychainProcessState().helperAccess = undefined
})

function countingResolver(answers: readonly HelperAccess[]) {
  let calls = 0
  const resolve = async (): Promise<HelperAccess> => answers[Math.min(calls++, answers.length - 1)] ?? ready
  return { resolve, calls: () => calls }
}

describe("a failed helper resolution is retried, never kept for the process (#11589 review)", () => {
  test("#given the first resolution is unavailable #when asked again #then it resolves again; a ready one is kept", async () => {
    const resolver = countingResolver([{ kind: "unavailable", reason: "pin directory missing" }, ready])
    expect((await sharedHelperAccess(resolver.resolve)).kind).toBe("unavailable")
    expect((await sharedHelperAccess(resolver.resolve)).kind).toBe("ready")
    expect((await sharedHelperAccess(resolver.resolve)).kind).toBe("ready")
    expect(resolver.calls()).toBe(2)
  })

  test.skipIf(!isDarwin)("#given no helper on the first resolve #when the store asks again after one appears #then it gets a backend, not a cached null", async () => {
    const binding = () =>
      bindKeychainHelper({
        platform: "darwin",
        namespace: "omo-cli",
        secrets: Bun.secrets,
        key: { service: "omo-cli", name: "f".repeat(64) },
        background: false,
        notice: () => {},
        pending: message => new Error(message),
      })
    const state = keychainProcessState()
    state.helperAccess = Promise.resolve<HelperAccess>({ kind: "missing" })
    expect(await binding().backend()).toBeNull()
    state.helperAccess = Promise.resolve(ready)
    expect(await binding().backend()).not.toBeNull()
  })
})
