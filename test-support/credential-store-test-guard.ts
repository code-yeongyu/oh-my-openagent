import { afterEach } from "bun:test"

// A test never opens the OS credential store (credential safety): it holds the developer's real sign-in, and a token
// refresh writes back to it. A runner that installs a fake (the root preload's hermetic store, or a test's own) marks it
// with the injected-secrets symbol; any other store is replaced by one that refuses every call and fails the test.

const INJECTED = Symbol.for("omo.test.injectedSecrets")

export type GuardedSecrets = { readonly secrets: unknown; readonly takeViolations: () => string[] }

/** The store a test process may use: an injected (fake) store as it is, the real one replaced by a refusing stand-in. */
export function guardSecrets(secrets: unknown): GuardedSecrets {
  const violations: string[] = []
  if (typeof secrets === "object" && secrets !== null && Reflect.get(secrets, INJECTED) === true)
    return { secrets, takeViolations: () => violations.splice(0) }
  const refuse = (operation: string) => async () => {
    const message = `a test called Bun.secrets.${operation} on the real OS credential store; inject a fake store`
    violations.push(message)
    throw new Error(message)
  }
  return {
    secrets: { get: refuse("get"), set: refuse("set"), delete: refuse("delete"), [INJECTED]: true },
    takeViolations: () => violations.splice(0),
  }
}

export function installCredentialStoreTestGuard(): GuardedSecrets {
  const guarded = guardSecrets(Reflect.get(Bun, "secrets"))
  // Value only: Bun.secrets is not configurable, but its value can be replaced (the hermetic preload does the same).
  Object.defineProperty(Bun, "secrets", { value: guarded.secrets })
  afterEach(() => {
    const found = guarded.takeViolations()
    if (found.length > 0) throw new Error(found.join("\n"))
  })
  return guarded
}
