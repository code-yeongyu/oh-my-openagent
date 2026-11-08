import { afterEach, describe, expect, test } from "bun:test"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { registerMemoryFilesystemPolicy } from "./policy-guard"
import {
  canonical,
  durableSibling,
  policyFixture,
  registeredPolicy,
} from "./policy-guard.test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

// `deniedRoots` is metadata no built-in tool consults, so the enumeration behind it is deferred to
// the first read instead of running while the session binds (#8412). These two tests pin both
// halves of that: the resolution really is deferred, and the snapshot it produces is the only one.
describe("memory filesystem policy denied roots", () => {
  test("#given a durable sibling that only appears after registration #when deniedRoots is first read #then it is resolved against the filesystem at read time", () => {
    const setup = policyFixture(roots)
    registerMemoryFilesystemPolicy(setup.pi, setup.own)
    const lateRoot = durableSibling(setup, "late")

    const deniedRoots = registeredPolicy(setup).deniedRoots ?? []

    expect(deniedRoots).toContain(canonical(lateRoot))
  })

  test("#given deniedRoots already read once #when another durable sibling appears #then the read snapshot is reused instead of re-enumerating", () => {
    const setup = policyFixture(roots)
    registerMemoryFilesystemPolicy(setup.pi, setup.own)
    const policy = registeredPolicy(setup)
    const first = policy.deniedRoots ?? []
    const laterRoot = durableSibling(setup, "later")

    const second = policy.deniedRoots ?? []

    expect(second).toEqual(first)
    expect(second).not.toContain(canonical(laterRoot))
  })
})
