import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { buildIdentityPaths, resolveMemoryIdentity } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext } from "./context"
import { registerMemoryGuard } from "./guard"
import { createMemoryComponent, memoryModuleSupervisor } from "./index"
import {
  componentContext,
  loadedMemoryConfig,
  MemoryFakeExtensionAPI,
  memorySettings,
  sessionContext,
} from "./memory.test-support"
import { TRANSIENT_DIRNAME } from "./transient-identity"
import {
  type FilesystemOperation,
  type FilesystemPolicy,
  type FilesystemPolicyDecision,
  hasFilesystemPolicySupport,
  registerMemoryFilesystemPolicy,
} from "./policy-guard"
import { canonical, policyFixture, registeredPolicy, type PolicyFixture } from "./policy-guard.test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function check(
  policy: FilesystemPolicy,
  operation: FilesystemOperation,
  canonicalPath: string,
  toolName = "read",
): Promise<FilesystemPolicyDecision> {
  return policy.check({ operation, canonicalPath, toolName })
}

class PolicyCapturingMemoryFakeExtensionAPI extends MemoryFakeExtensionAPI {
  readonly filesystemPolicies: FilesystemPolicy[] = []

  registerFilesystemPolicy(policy: FilesystemPolicy): void {
    this.filesystemPolicies.push(policy)
  }
}

describe("memory filesystem policy registration in the memory component (#15251)", () => {
  function registeredComponent(memoryHome: string, cwd: string) {
    const env = { OMO_MEMORY_HOME: memoryHome }
    const pi = new PolicyCapturingMemoryFakeExtensionAPI()
    createMemoryComponent({
      env,
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      resolveCwd: () => cwd,
      createRuntime: () => {
        throw new Error("policy registration test does not create an identity runtime")
      },
    }).register(pi, componentContext())
    const policy = pi.filesystemPolicies[0]
    if (policy === undefined) throw new Error("expected a registered filesystem policy")
    return { pi, policy, own: resolveMemoryIdentity(memorySettings().agent, cwd, env).paths.repo }
  }

  test("#given the memory component on a policy-capable host #when it registers #then its policy exists before any session starts, denies memory until the session binds, then carves out the bound identity", async () => {
    const memoryHome = join(policyFixture(roots).workspace, "memory")
    const { pi, policy, own } = registeredComponent(memoryHome, join(memoryHome, "..", "project"))
    const ownFile = join(own, "system", "persona.md")
    const foreign = join(memoryHome, "agents", "late-id", "repo", "system", "persona.md")

    // Senpi composes the policies its tools enforce here, before session_start.
    expect(pi.filesystemPolicies).toHaveLength(1)
    expect(await check(policy, "read", ownFile)).toMatchObject({ allow: false })
    expect(await check(policy, "read", foreign)).toMatchObject({ allow: false })

    await pi.dispatch("session_start", {}, sessionContext({ notifications: [] }))

    expect(pi.filesystemPolicies).toHaveLength(1)
    expect(await check(policy, "read", ownFile)).toEqual({ allow: true })
    expect(await check(policy, "read", foreign)).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: read ${foreign}`,
    })
    memoryModuleSupervisor.release()
  })

  test("#given two session runtimes bound to different identities #when each policy is asked #then each judges by its own session's identity only", async () => {
    const memoryHome = join(policyFixture(roots).workspace, "memory")
    const first = registeredComponent(memoryHome, join(memoryHome, "..", "project-one"))
    const second = registeredComponent(memoryHome, join(memoryHome, "..", "project-two"))
    await first.pi.dispatch("session_start", {}, sessionContext({ notifications: [], sessionId: "session-one", cwd: join(memoryHome, "..", "project-one") }))
    await second.pi.dispatch("session_start", {}, sessionContext({ notifications: [], sessionId: "session-two", cwd: join(memoryHome, "..", "project-two") }))
    const firstFile = join(first.own, "system", "persona.md")
    const secondFile = join(second.own, "system", "persona.md")

    expect(first.own).not.toBe(second.own)
    expect(await check(first.policy, "read", firstFile)).toEqual({ allow: true })
    expect(await check(first.policy, "read", secondFile)).toMatchObject({ allow: false })
    expect(await check(second.policy, "read", secondFile)).toEqual({ allow: true })
    expect(await check(second.policy, "read", firstFile)).toMatchObject({ allow: false })
    memoryModuleSupervisor.release()
    memoryModuleSupervisor.release()
  })
})

describe("memory filesystem policy guard", () => {
  test("#given a bound identity on a policy-capable host #when registration runs #then exactly one policy is registered with foreign-only denied roots", () => {
    const setup = policyFixture(roots)

    const result = registerMemoryFilesystemPolicy(setup.pi, () => setup.own, setup.memoryRoot)

    expect(result).toEqual({ status: "registered" })
    expect(setup.pi.filesystemPolicies).toHaveLength(1)
    const deniedRoots = registeredPolicy(setup).deniedRoots ?? []
    expect(deniedRoots).toContain(canonical(setup.foreignRoot))
    expect(deniedRoots).not.toContain(canonical(setup.own.identityPaths.root))
    expect(deniedRoots).not.toContain(resolve(setup.own.identityPaths.root))
  })

  test("#given the registered policy #when read and write target a foreign identity file #then both are denied with the stable reason", async () => {
    const setup = policyFixture(roots)
    registerMemoryFilesystemPolicy(setup.pi, () => setup.own, setup.memoryRoot)
    const policy = registeredPolicy(setup)
    const foreign = canonical(setup.foreignFile)

    expect(await check(policy, "read", foreign)).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: read ${foreign}`,
    })
    expect(await check(policy, "write", foreign, "write")).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: write ${foreign}`,
    })
  })

  test("#given the registered policy #when enumeration targets the agents root or a foreign root #then both are denied", async () => {
    const setup = policyFixture(roots)
    registerMemoryFilesystemPolicy(setup.pi, () => setup.own, setup.memoryRoot)
    const policy = registeredPolicy(setup)
    const agents = canonical(setup.agentsRoot)
    const foreign = canonical(setup.foreignRoot)

    expect(await check(policy, "enumerate", agents, "ls")).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: enumerate ${agents}`,
    })
    expect(await check(policy, "enumerate", foreign, "ls")).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: enumerate ${foreign}`,
    })
  })

  test("#given the registered policy #when operations target the bound identity repo and worktrees #then they are allowed", async () => {
    const setup = policyFixture(roots)
    registerMemoryFilesystemPolicy(setup.pi, () => setup.own, setup.memoryRoot)
    const policy = registeredPolicy(setup)

    expect(await check(policy, "read", canonical(setup.ownRepoFile))).toEqual({ allow: true })
    expect(await check(policy, "write", canonical(setup.ownWorktreeFile), "write")).toEqual({ allow: true })
    expect(await check(policy, "enumerate", canonical(setup.own.identityPaths.root), "ls")).toEqual({ allow: true })
  })

  test("#given the registered policy #when an operation targets a path outside the agents root #then it is allowed", async () => {
    const setup = policyFixture(roots)
    registerMemoryFilesystemPolicy(setup.pi, () => setup.own, setup.memoryRoot)
    const policy = registeredPolicy(setup)

    expect(await check(policy, "read", canonical(setup.outsideFile))).toEqual({ allow: true })
  })

  test("#given the registered policy #when a sibling identity appears after registration #then its files are still denied", async () => {
    const setup = policyFixture(roots)
    registerMemoryFilesystemPolicy(setup.pi, () => setup.own, setup.memoryRoot)
    const policy = registeredPolicy(setup)

    const intruderPaths = buildIdentityPaths(setup.memoryRoot, "intruder")
    const intruderFile = join(intruderPaths.repo, "system", "persona.md")
    mkdirSync(dirname(intruderFile), { recursive: true })
    writeFileSync(intruderFile, "intruder")
    const intruder = canonical(intruderFile)

    expect(await check(policy, "read", intruder)).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: read ${intruder}`,
    })
  })

  test("#given no bound identity #when the registered policy is asked #then it denies both memory areas and allows everything outside them (fail closed)", async () => {
    const setup = policyFixture(roots)

    const result = registerMemoryFilesystemPolicy(setup.pi, () => undefined, setup.memoryRoot)

    expect(result).toEqual({ status: "registered" })
    const policy = registeredPolicy(setup)
    const transientFile = join(setup.memoryRoot, TRANSIENT_DIRNAME, "run-1", "agents", "own", "repo", "notes.md")
    mkdirSync(dirname(transientFile), { recursive: true })
    writeFileSync(transientFile, "transient")
    for (const [operation, path] of [
      ["read", setup.foreignFile],
      ["write", setup.foreignFile],
      ["read", setup.ownRepoFile],
      ["enumerate", setup.agentsRoot],
      ["read", transientFile],
    ] as const) {
      const target = canonical(path)
      expect(await check(policy, operation, target)).toEqual({
        allow: false,
        reason: `cross-identity memory access denied: ${operation} ${target}`,
      })
    }
    expect(await check(policy, "read", canonical(setup.outsideFile))).toEqual({ allow: true })
    expect(await check(policy, "enumerate", canonical(setup.memoryRoot), "ls")).toEqual({ allow: true })
    expect(policy.deniedRoots).toContain(canonical(setup.agentsRoot))
  })

  test("#given a bound session that shut down #when the policy is asked before the next session binds #then the memory areas are denied again", async () => {
    const setup = policyFixture(roots)
    let bound: typeof setup.own | undefined = setup.own
    registerMemoryFilesystemPolicy(setup.pi, () => bound, setup.memoryRoot)
    const policy = registeredPolicy(setup)
    const own = canonical(setup.ownRepoFile)
    expect(await check(policy, "read", own)).toEqual({ allow: true })

    bound = undefined

    expect(await check(policy, "read", own)).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: read ${own}`,
    })
  })

  test("#given one registered policy #when the session binds after registration #then the same policy carves out the bound identity and denies foreign ones from then on (#15251)", async () => {
    const setup = policyFixture(roots)
    let bound: typeof setup.own | undefined
    registerMemoryFilesystemPolicy(setup.pi, () => bound, setup.memoryRoot)
    const policy = registeredPolicy(setup)
    const foreign = canonical(setup.foreignFile)
    const own = canonical(setup.ownRepoFile)
    expect(await check(policy, "read", own)).toMatchObject({ allow: false })

    bound = setup.own

    expect(setup.pi.filesystemPolicies).toHaveLength(1)
    expect(await check(policy, "read", own)).toEqual({ allow: true })
    expect(await check(policy, "read", foreign)).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: read ${foreign}`,
    })
  })

  test("#given a host without the policy API #when registration runs #then nothing is registered and the soft guard stays the enforcement layer", async () => {
    const setup = policyFixture(roots)
    const pi = new FakeExtensionAPI()

    expect(hasFilesystemPolicySupport(pi)).toBe(false)
    const result = registerMemoryFilesystemPolicy(pi, () => setup.own, setup.memoryRoot)

    expect(result).toEqual({ status: "unsupported" })

    const context = componentContext()
    registerMemoryGuard(pi, context, {
      getContext: () => setup.own,
      resolveCwd: () => setup.workspace,
    })
    const results = await pi.dispatch(
      "tool_call",
      { type: "tool_call", toolCallId: "call-1", toolName: "read", input: { path: setup.foreignFile } },
      { sessionManager: { getSessionId: () => "session-1" } },
    )
    expect(results[0]).toEqual({
      block: true,
      reason: `cross-identity memory access denied: read to ${setup.foreignFile} belongs to another memory identity`,
    })
  })

  test("#given the capability check #when the host exposes the policy API #then support is detected without any cast", () => {
    const setup = policyFixture(roots)

    expect(hasFilesystemPolicySupport(setup.pi)).toBe(true)
  })

  test("#given runtime-only sibling directories #when the policy registers #then only durable identities are denied roots and the strays stay denied by the check", async () => {
    const setup = policyFixture(roots)
    const strayPaths = buildIdentityPaths(setup.memoryRoot, "stray-run")
    mkdirSync(join(strayPaths.transcripts, "stream-1"), { recursive: true })

    registerMemoryFilesystemPolicy(setup.pi, () => setup.own, setup.memoryRoot)
    const policy = registeredPolicy(setup)

    const deniedRoots = policy.deniedRoots ?? []
    expect(deniedRoots).toContain(canonical(setup.foreignRoot))
    expect(deniedRoots).not.toContain(canonical(strayPaths.root))
    const stray = canonical(strayPaths.transcripts)
    expect(await check(policy, "read", stray)).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: read ${stray}`,
    })
  })

  test("#given a transient run identity #when the policy registers #then the durable agents root and other transient runs are denied while its own run root is allowed", async () => {
    const setup = policyFixture(roots)
    const runPaths = buildIdentityPaths(join(setup.memoryRoot, TRANSIENT_DIRNAME, "token-1"), "own")
    const otherRunPaths = buildIdentityPaths(join(setup.memoryRoot, TRANSIENT_DIRNAME, "token-2"), "other")
    mkdirSync(join(runPaths.transcripts, "stream-1"), { recursive: true })
    mkdirSync(join(otherRunPaths.transcripts, "stream-1"), { recursive: true })
    const transient = createMemoryIdentityContext({
      identity: "own",
      identityPaths: runPaths,
      durableRoot: setup.own.identityPaths.root,
      binding: { identity: "own", repoPathHash: "hash", boundAt: 1 },
    })

    registerMemoryFilesystemPolicy(setup.pi, () => transient, setup.memoryRoot)
    const policy = registeredPolicy(setup)

    expect(await check(policy, "write", canonical(runPaths.transcripts), "write")).toEqual({ allow: true })
    expect(await check(policy, "read", canonical(setup.foreignFile))).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: read ${canonical(setup.foreignFile)}`,
    })
    const otherRun = canonical(otherRunPaths.transcripts)
    expect(await check(policy, "read", otherRun)).toEqual({
      allow: false,
      reason: `cross-identity memory access denied: read ${otherRun}`,
    })
  })

  test("#given the policy guard module source #when imports are audited #then senpi references are type-only with no runtime import or any-cast", () => {
    const source = readFileSync(resolve(import.meta.dir, "policy-guard.ts"), "utf8")

    const runtimeSenpiImports = source
      .split("\n")
      .filter((line) => /^\s*import\s+(?!type\b).+\s+from\s+["']@code-yeongyu\/senpi["']/.test(line))
    expect(runtimeSenpiImports).toEqual([])
    expect(source).not.toContain("require(")
    expect(source).not.toContain("as any")
  })
})
