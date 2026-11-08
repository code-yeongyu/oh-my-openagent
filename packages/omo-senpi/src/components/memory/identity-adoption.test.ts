import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { createMemoryBinding } from "./binding"
import { adoptSessionIdentity, type BoundIdentity } from "./identity-adoption"

const MEMORY_ROOT = join("/", "memory-root")
const OTHER_ROOT = join("/", "other-root")

function identity(id: string, memoryRoot = MEMORY_ROOT): BoundIdentity {
  return { id, paths: buildIdentityPaths(memoryRoot, id) }
}

function recordedFor(bound: BoundIdentity): ReturnType<typeof createMemoryBinding> {
  return createMemoryBinding({ identity: bound.id, repoPath: bound.paths.repo, boundAt: 1 })
}

describe("adoptSessionIdentity", () => {
  test("#given no recorded binding #when a session binds #then the resolved identity is used", () => {
    const resolved = identity("alpha-1111")

    const adoption = adoptSessionIdentity({
      recorded: undefined,
      resolved,
      memoryRoot: MEMORY_ROOT,
      configAgentValue: "auto",
      verifyRepository: true,
    })

    expect(adoption).toEqual({ kind: "resolved", identity: resolved })
  })

  test("#given a recorded binding that agrees #when the repository is verified #then the resolved identity is used", () => {
    const resolved = identity("alpha-1111")

    const adoption = adoptSessionIdentity({
      recorded: recordedFor(resolved),
      resolved,
      memoryRoot: MEMORY_ROOT,
      configAgentValue: "auto",
      verifyRepository: true,
    })

    expect(adoption).toEqual({ kind: "resolved", identity: resolved })
  })

  test("#given a recorded binding whose repository cannot be reproduced #when the repository is verified #then it conflicts", () => {
    const resolved = identity("alpha-1111")

    const adoption = adoptSessionIdentity({
      recorded: { ...recordedFor(resolved), repoPathHash: "other-repository" },
      resolved,
      memoryRoot: MEMORY_ROOT,
      configAgentValue: "auto",
      verifyRepository: true,
    })

    expect(adoption).toEqual({ kind: "conflict" })
  })

  test("#given an auto identity that disagrees with the recorded binding #when adopted #then the recorded identity wins with its own paths", () => {
    const bound = identity("alpha-1111")

    const adoption = adoptSessionIdentity({
      recorded: recordedFor(bound),
      resolved: identity("server-2222"),
      memoryRoot: MEMORY_ROOT,
      configAgentValue: "auto",
      verifyRepository: true,
    })

    expect(adoption).toEqual({ kind: "rebound", identity: bound })
  })

  test("#given an explicitly configured agent that disagrees with the recorded binding #when adopted #then it conflicts", () => {
    const bound = identity("alpha-1111")

    const adoption = adoptSessionIdentity({
      recorded: recordedFor(bound),
      resolved: identity("fresh-3333"),
      memoryRoot: MEMORY_ROOT,
      configAgentValue: "fresh",
      verifyRepository: true,
    })

    expect(adoption).toEqual({ kind: "conflict" })
  })

  test("#given a recorded identity whose repository lived under another memory root #when adopted #then it conflicts instead of silently relocating", () => {
    const bound = identity("alpha-1111", OTHER_ROOT)

    const adoption = adoptSessionIdentity({
      recorded: recordedFor(bound),
      resolved: identity("server-2222"),
      memoryRoot: MEMORY_ROOT,
      configAgentValue: "auto",
      verifyRepository: false,
    })

    expect(adoption).toEqual({ kind: "conflict" })
  })
})
