import { afterEach, describe, expect, test } from "bun:test"
import type { HelperAccess } from "./access"
import { sharedHelperAccess } from "./darwin-backend"
import { keychainProcessState } from "./process-state"
import { bindKeychainHelper } from "./store-binding"

const isDarwin = process.platform === "darwin"
const ready: HelperAccess = { kind: "ready", path: "/fake/omo-keychain", call: async () => ({ missing: true }) }

const original = Bun.secrets
afterEach(() => {
  keychainProcessState().helperAccess = undefined
  Object.defineProperty(Bun, "secrets", { value: original })
})

// The preloaded hermetic Bun.secrets is marked injected, so it is never helper-eligible; this test needs an unmarked
// stand-in that the store takes for the real one, with helperAccess injected so no real helper or Keychain is reached.
function installUnmarkedSecrets(): void {
  Object.defineProperty(Bun, "secrets", {
    value: { get: async () => null, set: async () => {}, delete: async () => true },
  })
}

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

  test("#given the first resolution rejects #when asked again #then it resolves again instead of keeping the rejection", async () => {
    let calls = 0
    const resolve = async (): Promise<HelperAccess> => {
      calls += 1
      if (calls === 1) throw new Error("checker crashed")
      return ready
    }
    await expect(sharedHelperAccess(resolve)).rejects.toThrow("checker crashed")
    expect((await sharedHelperAccess(resolve)).kind).toBe("ready")
    expect(calls).toBe(2)
  })

  test.skipIf(!isDarwin)(
    "#given no helper on the first resolve #when the store asks again after one appears #then it gets a backend, not a cached null",
    async () => {
      installUnmarkedSecrets()
      const binding = () =>
        bindKeychainHelper({
          platform: "darwin",
          namespace: "omo-cli",
          secrets: Bun.secrets,
          key: { service: "omo-cli", name: "f".repeat(64) },
          background: false,
          origin: "https://api.example.test",
          notice: () => {},
          pending: (message) => new Error(message),
        })
      const state = keychainProcessState()
      state.helperAccess = Promise.resolve<HelperAccess>({ kind: "missing" })
      expect(await binding().backend()).toBeNull()
      state.helperAccess = Promise.resolve(ready)
      expect(await binding().backend()).not.toBeNull()
    },
  )
})
