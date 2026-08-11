import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { registerMemoryGuard } from "./guard"
import { componentContext } from "./memory.test-support"
import {
  type FilesystemOperation,
  type FilesystemPolicy,
  type FilesystemPolicyDecision,
  hasFilesystemPolicySupport,
  registerMemoryFilesystemPolicy,
} from "./policy-guard"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

class PolicyCapturingFakeExtensionAPI extends FakeExtensionAPI {
  readonly filesystemPolicies: FilesystemPolicy[] = []

  registerFilesystemPolicy(policy: FilesystemPolicy): void {
    this.filesystemPolicies.push(policy)
  }
}

type PolicyFixture = {
  readonly pi: PolicyCapturingFakeExtensionAPI
  readonly own: MemoryIdentityContext
  readonly memoryRoot: string
  readonly workspace: string
  readonly ownRepoFile: string
  readonly ownWorktreeFile: string
  readonly foreignRoot: string
  readonly foreignFile: string
  readonly agentsRoot: string
  readonly outsideFile: string
}

function fixture(): PolicyFixture {
  const memoryRoot = mkdtempSync(join(tmpdir(), "omo-memory-policy-"))
  const workspace = mkdtempSync(join(tmpdir(), "omo-memory-policy-workspace-"))
  roots.push(memoryRoot, workspace)

  const ownPaths = buildIdentityPaths(memoryRoot, "own")
  const foreignPaths = buildIdentityPaths(memoryRoot, "foreign")
  const ownRepoFile = join(ownPaths.repo, "system", "persona.md")
  const ownWorktreeFile = join(ownPaths.worktrees, "reflection", "notes.md")
  const foreignFile = join(foreignPaths.repo, "system", "persona.md")
  mkdirSync(dirname(ownRepoFile), { recursive: true })
  mkdirSync(dirname(ownWorktreeFile), { recursive: true })
  mkdirSync(dirname(foreignFile), { recursive: true })
  writeFileSync(ownRepoFile, "own")
  writeFileSync(ownWorktreeFile, "worktree")
  writeFileSync(foreignFile, "foreign")
  const outsideFile = join(workspace, "notes.md")
  writeFileSync(outsideFile, "outside")

  const own = createMemoryIdentityContext({
    identity: "own",
    identityPaths: ownPaths,
    binding: { identity: "own", repoPathHash: "hash", boundAt: 1 },
  })

  return {
    pi: new PolicyCapturingFakeExtensionAPI(),
    own,
    memoryRoot,
    workspace,
    ownRepoFile,
    ownWorktreeFile,
    foreignRoot: foreignPaths.root,
    foreignFile,
    agentsRoot: dirname(ownPaths.root),
    outsideFile,
  }
}

function canonical(path: string): string {
  return realpathSync(path)
}

function registeredPolicy(setup: PolicyFixture): FilesystemPolicy {
  const policy = setup.pi.filesystemPolicies[0]
  if (policy === undefined) throw new Error("expected a registered filesystem policy")
  return policy
}

async function check(
  policy: FilesystemPolicy,
  operation: FilesystemOperation,
  canonicalPath: string,
  toolName = "read",
): Promise<FilesystemPolicyDecision> {
  return policy.check({ operation, canonicalPath, toolName })
}

describe("memory filesystem policy guard", () => {
  test("#given a bound identity on a policy-capable host #when registration runs #then exactly one policy is registered with foreign-only denied roots", () => {
    const setup = fixture()

    const result = registerMemoryFilesystemPolicy(setup.pi, setup.own)

    expect(result).toEqual({ status: "registered" })
    expect(setup.pi.filesystemPolicies).toHaveLength(1)
    const deniedRoots = registeredPolicy(setup).deniedRoots ?? []
    expect(deniedRoots).toContain(canonical(setup.foreignRoot))
    expect(deniedRoots).not.toContain(canonical(setup.own.identityPaths.root))
    expect(deniedRoots).not.toContain(resolve(setup.own.identityPaths.root))
  })

  test("#given the registered policy #when read and write target a foreign identity file #then both are denied with the stable reason", async () => {
    const setup = fixture()
    registerMemoryFilesystemPolicy(setup.pi, setup.own)
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
    const setup = fixture()
    registerMemoryFilesystemPolicy(setup.pi, setup.own)
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
    const setup = fixture()
    registerMemoryFilesystemPolicy(setup.pi, setup.own)
    const policy = registeredPolicy(setup)

    expect(await check(policy, "read", canonical(setup.ownRepoFile))).toEqual({ allow: true })
    expect(await check(policy, "write", canonical(setup.ownWorktreeFile), "write")).toEqual({ allow: true })
    expect(await check(policy, "enumerate", canonical(setup.own.identityPaths.root), "ls")).toEqual({ allow: true })
  })

  test("#given the registered policy #when an operation targets a path outside the agents root #then it is allowed", async () => {
    const setup = fixture()
    registerMemoryFilesystemPolicy(setup.pi, setup.own)
    const policy = registeredPolicy(setup)

    expect(await check(policy, "read", canonical(setup.outsideFile))).toEqual({ allow: true })
  })

  test("#given the registered policy #when a sibling identity appears after registration #then its files are still denied", async () => {
    const setup = fixture()
    registerMemoryFilesystemPolicy(setup.pi, setup.own)
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

  test("#given an unbound identity on a policy-capable host #when registration runs #then no policy is registered", () => {
    const setup = fixture()

    const result = registerMemoryFilesystemPolicy(setup.pi, undefined)

    expect(result).toEqual({ status: "unbound" })
    expect(setup.pi.filesystemPolicies).toHaveLength(0)
  })

  test("#given a host without the policy API #when registration runs #then nothing is registered and the soft guard stays the enforcement layer", async () => {
    const setup = fixture()
    const pi = new FakeExtensionAPI()

    expect(hasFilesystemPolicySupport(pi)).toBe(false)
    const result = registerMemoryFilesystemPolicy(pi, setup.own)

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
    const setup = fixture()

    expect(hasFilesystemPolicySupport(setup.pi)).toBe(true)
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
