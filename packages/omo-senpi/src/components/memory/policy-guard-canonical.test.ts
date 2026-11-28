import { afterEach, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync as nodeRealpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix, win32 } from "node:path"

import * as memoryFs from "@oh-my-opencode/memory-core/fs"

import { isWithin } from "./guard-foreign-roots"
import {
  canonical,
  policyFixture,
  PolicyCapturingFakeExtensionAPI,
  registeredPolicy,
} from "./policy-guard.test-support"
import { registerMemoryFilesystemPolicy } from "./policy-guard"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test("#given a memory root written with a short name the native realpath expands #when another identity is read by its long name #then the policy denies it (#15251)", async () => {
  // Windows keeps an 8.3 name (RUNNER~1) in the JS realpath and expands it in the native one, which is what senpi
  // canonicalizes request paths with. The native realpath is faked to do that expansion on this host.
  const base = nodeRealpathSync(mkdtempSync(join(tmpdir(), "omo-policy-short-")))
  roots.push(base)
  const memoryRoot = join(base, "RUNNER~1", "memory")
  mkdirSync(join(memoryRoot, "agents", "late-id", "repo"), { recursive: true })
  const realNative = memoryFs.realpathSync.native
  const expand = spyOn(memoryFs.realpathSync, "native").mockImplementation(((path: string) =>
    String(realNative(path)).replace(/\/RUNNER~1(?=\/|$)/, "/runneradmin")) as typeof memoryFs.realpathSync.native)
  try {
    const pi = new PolicyCapturingFakeExtensionAPI()
    registerMemoryFilesystemPolicy(pi, () => undefined, memoryRoot)
    const [policy] = pi.filesystemPolicies
    if (policy === undefined) throw new Error("no policy registered")
    const target = join(base, "runneradmin", "memory", "agents", "late-id", "repo", "system", "persona.md")

    const decision = await policy.check({ operation: "read", canonicalPath: target, toolName: "read" })

    expect(expand).toHaveBeenCalled()
    expect(decision).toEqual({ allow: false, reason: `cross-identity memory access denied: read ${target}` })
  } finally {
    expand.mockRestore()
  }
})

test("#given an identity directory whose name starts with '..' #when the policy is asked #then it is inside the memory area and denied", async () => {
  const setup = policyFixture(roots)
  registerMemoryFilesystemPolicy(setup.pi, () => undefined, setup.memoryRoot)
  const target = join(canonical(setup.agentsRoot), "..x", "repo", "system", "persona.md")

  expect(await registeredPolicy(setup).check({ operation: "read", canonicalPath: target, toolName: "read" })).toEqual({
    allow: false,
    reason: `cross-identity memory access denied: read ${target}`,
  })
})

test("#given containment checks #when a child's name starts with '..' #then it is inside, while '..' segments and siblings are outside", () => {
  expect(isWithin("/m/agents", "/m/agents/..x/repo", posix)).toBe(true)
  expect(isWithin("/m/agents", "/m/agents/...", posix)).toBe(true)
  expect(isWithin("/m/agents", "/m/agents", posix)).toBe(true)
  expect(isWithin("/m/agents", "/m/agents/../other", posix)).toBe(false)
  expect(isWithin("/m/agents", "/m", posix)).toBe(false)
  expect(isWithin("/m/agents", "/m/agents-other/x", posix)).toBe(false)
  expect(isWithin(String.raw`C:\m\agents`, String.raw`C:\m\agents\..x\repo`, win32)).toBe(true)
  expect(isWithin(String.raw`C:\m\agents`, String.raw`C:\m\other`, win32)).toBe(false)
  expect(isWithin(String.raw`C:\m\agents`, String.raw`D:\m\agents\x`, win32)).toBe(false)
})
