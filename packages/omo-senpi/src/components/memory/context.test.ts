import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext, ensureIdentityRuntimeDirs } from "./context"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe("memory identity context", () => {
  test("#given a resolved identity #when its context and repo getter are read #then no repository or runtime directory is created", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-memory-context-"))
    roots.push(root)
    const paths = buildIdentityPaths(root, "agent-123")
    const context = createMemoryIdentityContext({
      identity: "agent-123",
      identityPaths: paths,
      binding: { identity: "agent-123", repoPathHash: "hash", boundAt: 1 },
    })

    expect(context.repoAccess.path).toBe(paths.repo)
    expect(existsSync(paths.repo)).toBe(false)
    expect(existsSync(paths.runtime)).toBe(false)
  })

  test("#given untouched identity paths #when first-write setup runs #then only runtime structure is ensured idempotently", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-memory-context-"))
    roots.push(root)
    const paths = buildIdentityPaths(root, "agent-123")

    await ensureIdentityRuntimeDirs(paths)
    await ensureIdentityRuntimeDirs(paths)

    expect(existsSync(paths.runtime)).toBe(true)
    expect(existsSync(paths.locks)).toBe(true)
    expect(existsSync(paths.transcripts)).toBe(true)
    expect(existsSync(paths.reflection)).toBe(true)
    expect(existsSync(paths.reflectionSessions)).toBe(true)
    expect(existsSync(paths.worktrees)).toBe(true)
    expect(existsSync(paths.viewers)).toBe(true)
    expect(existsSync(paths.pushQueue)).toBe(true)
    expect(existsSync(paths.factsQueue)).toBe(true)
    expect(existsSync(paths.facts)).toBe(true)
    expect(existsSync(paths.repo)).toBe(false)
  })
})
