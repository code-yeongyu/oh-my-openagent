import { afterEach, describe, expect, test } from "bun:test"
import type { SecretApi } from "../keystore"
import { bindKeychainHelper } from "./store-binding"

// Security contract (#11262): only the real macOS store of the sign-in item may take the signed-helper path. A launcher
// preload that replaces Bun.secrets with a stand-in marks it (cli-keystore.fixture.ts, accounts-closed.fixture.ts); on
// darwin an unmarked stand-in was taken for the real store and the child reached the login Keychain.
const original = Bun.secrets
afterEach(() => {
  Object.defineProperty(Bun, "secrets", { value: original })
})

function installStandIn(marked: boolean): SecretApi {
  const standIn = {
    get: async () => null,
    set: async () => {},
    delete: async () => true,
    ...(marked ? { [Symbol.for("omo.test.injectedSecrets")]: true } : {}),
  }
  Object.defineProperty(Bun, "secrets", { value: standIn })
  return standIn
}

const bindDarwinSignIn = (secrets: SecretApi) =>
  bindKeychainHelper({
    platform: "darwin",
    namespace: "omo-cli",
    secrets,
    key: { service: "omo-cli", name: "a".repeat(64) },
    background: false,
    notice: () => {},
    pending: message => new Error(message),
  })

describe("a launcher-injected Bun.secrets is never the real macOS store (#11262)", () => {
  test("#given the preloaded hermetic Bun.secrets (test-hermetic-home.ts) #when a darwin sign-in store binds #then it is not helper-eligible", () => {
    expect(bindDarwinSignIn(original).eligible).toBe(false)
  })

  test("#given Bun.secrets replaced by a marked stand-in #when the darwin sign-in store binds #then it is not helper-eligible and keeps the stand-in", async () => {
    const standIn = installStandIn(true)
    const binding = bindDarwinSignIn(Bun.secrets)
    expect(binding.eligible).toBe(false)
    expect(binding.secrets).toBe(standIn)
    expect(await binding.backend()).toBeNull()
  })

  test("#given the same stand-in without the mark #when the darwin sign-in store binds #then identity alone makes it eligible (why fixtures must mark)", () => {
    installStandIn(false)
    expect(bindDarwinSignIn(Bun.secrets).eligible).toBe(true)
  })
})
