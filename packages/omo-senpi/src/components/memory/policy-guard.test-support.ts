import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import type { FilesystemPolicy } from "./policy-guard"

export class PolicyCapturingFakeExtensionAPI extends FakeExtensionAPI {
  readonly filesystemPolicies: FilesystemPolicy[] = []

  registerFilesystemPolicy(policy: FilesystemPolicy): void {
    this.filesystemPolicies.push(policy)
  }
}

export type PolicyFixture = {
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

/** Creates the shared policy fixture; `roots` collects the temp trees for the caller's afterEach. */
export function policyFixture(roots: string[]): PolicyFixture {
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

export function canonical(path: string): string {
  return realpathSync(path)
}

export function registeredPolicy(setup: PolicyFixture): FilesystemPolicy {
  const policy = setup.pi.filesystemPolicies[0]
  if (policy === undefined) throw new Error("expected a registered filesystem policy")
  return policy
}

/** Writes a durable (repo-owning) sibling identity under the fixture's memory root. */
export function durableSibling(setup: PolicyFixture, identity: string): string {
  const paths = buildIdentityPaths(setup.memoryRoot, identity)
  mkdirSync(join(paths.repo, "system"), { recursive: true })
  writeFileSync(join(paths.repo, "system", "persona.md"), identity)
  return paths.root
}
