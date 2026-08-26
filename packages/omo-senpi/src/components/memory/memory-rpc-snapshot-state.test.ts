import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmEfaultTolerant } from "./teardown.test-support"

import { GitMemoryRepo, buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import type { MemoryRpcGitRepo } from "./memory-rpc-bridge"
import {
  buildMemorySnapshot,
  createMemoryRpcGitRepo,
  estimateSystemTokens,
  memoryTreeStats,
} from "./memory-rpc-snapshot-state"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixtureRepo(): Promise<{ dir: string; repo: GitMemoryRepo; head: string }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-rpc-snapshot-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "omo-memory-rpc" })
  const head = await repo.init({
    seedFiles: [
      { relativePath: "system/persona.md", content: "persona\n" },
      { relativePath: "system/nested/guide.md", content: "guide 🧠\n" },
      { relativePath: "system/theme.css", content: "/* not markdown */\n" },
      { relativePath: "notes.md", content: "working notes\n" },
      { relativePath: "journal/day.md", content: "journal\n" },
    ],
  })
  return { dir, repo, head }
}

async function estimateSystemTokensLegacy(
  repo: GitMemoryRepo,
  head: string,
): Promise<number> {
  const paths = (await repo.lsTree(head)).filter((path) => path.startsWith("system/") && path.endsWith(".md"))
  const contents = await Promise.all(paths.map((path) => repo.show(head, path)))
  const totalBytes = contents.reduce((sum, content) => sum + Buffer.byteLength(content, "utf8"), 0)
  return Math.floor(totalBytes / 4)
}

describe("estimateSystemTokens", () => {
  test("#given system and non-system markdown #when estimated from lsTreeSized #then the result matches the old per-path show loop", async () => {
    // given
    const { dir, repo, head } = await fixtureRepo()
    const reference = await estimateSystemTokensLegacy(repo, head)

    // when
    const estimate = await estimateSystemTokens(createMemoryRpcGitRepo(dir), head, new Map())

    // then
    expect(reference).toBeGreaterThan(0)
    expect(estimate).toBe(reference)
  })
})

describe("memoryTreeStats", () => {
  test("#given a sized tree listing #when summarized #then totals isolate system bytes and group by top-level path", () => {
    // given
    const entries = [
      { path: "system/persona.md", bytes: 40 },
      { path: "system/nested/guide.md", bytes: 8 },
      { path: "notes.md", bytes: 20 },
      { path: "journal/day.md", bytes: 12 },
    ]

    // when
    const stats = memoryTreeStats(entries)

    // then
    expect(stats).toEqual({
      totalBytes: 80,
      fileCount: 4,
      systemBytes: 48,
      systemMarkdownBytes: 48,
      byTopLevel: { system: 48, "notes.md": 20, journal: 12 },
    })
  })

  test("#given non-markdown files under system/ #when summarized #then systemBytes counts them but systemMarkdownBytes does not", () => {
    // given
    const entries = [
      { path: "system/persona.md", bytes: 40 },
      { path: "system/theme.css", bytes: 25 },
    ]

    // when
    const stats = memoryTreeStats(entries)

    // then
    expect(stats.systemBytes).toBe(65)
    expect(stats.systemMarkdownBytes).toBe(40)
  })
})

async function contextFixture(): Promise<MemoryIdentityContext> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-rpc-snapshot-ctx-")))
  tempDirs.push(root)
  const paths = buildIdentityPaths(root, "agent-test")
  await mkdir(paths.transcripts, { recursive: true })
  await mkdir(join(paths.reflection, "completions"), { recursive: true })
  return createMemoryIdentityContext({
    identity: "agent-test",
    identityPaths: paths,
    binding: { identity: "agent-test", repoPathHash: "hash", boundAt: 1 },
  })
}

function stubRepo(overrides: Partial<MemoryRpcGitRepo> = {}): MemoryRpcGitRepo {
  return {
    head: async () => "0123456789abcdef0123456789abcdef01234567",
    headCommitTimestamp: async () => Date.parse("2026-08-10T00:00:00.000Z") / 1000,
    headSubject: async () => "memory: record the plan",
    status: async () => "",
    lsTree: async () => [],
    show: async () => "",
    ...overrides,
  }
}

function snapshotDeps(
  repo: MemoryRpcGitRepo,
  overrides: Partial<Parameters<typeof buildMemorySnapshot>[2]> = {},
): Parameters<typeof buildMemorySnapshot>[2] {
  return {
    repo,
    activeRun: () => undefined,
    tokenEstimates: new Map(),
    treeStats: new Map(),
    ...overrides,
  }
}

async function writeCompletion(
  context: MemoryIdentityContext,
  record: Record<string, unknown>,
): Promise<void> {
  const dir = join(context.identityPaths.reflection, "completions")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${String(record.runId)}.json`), JSON.stringify(record), "utf8")
}

function completion(
  runId: string,
  outcome: string,
  finishedAt: string,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId,
    identity: "agent-test",
    category: "quick",
    conversationIds: ["session-1"],
    trigger: "step_count",
    outcome,
    startedAt: finishedAt,
    finishedAt,
    delivery: { status: "consumed" },
  }
}

describe("buildMemorySnapshot v1 compatibility", () => {
  test("#given a bound session #when a snapshot is built #then every v1 field keeps its name and type at schemaVersion 1", async () => {
    // given
    const context = await contextFixture()

    // when
    const snapshot = await buildMemorySnapshot(context, "session-1", snapshotDeps(stubRepo(), {
      activeRun: () => ({
        runId: "run-2",
        trigger: "manual",
        category: "quick",
        model: "sonnet",
        startedAt: "2026-08-10T01:00:00.000Z",
      }),
    }))

    // then
    expect(snapshot.schemaVersion).toBe(1)
    expect(typeof snapshot.identity).toBe("string")
    expect(typeof snapshot.repo.headSha).toBe("string")
    expect(typeof snapshot.repo.headSubject).toBe("string")
    expect(typeof snapshot.repo.committedAtISO).toBe("string")
    expect(typeof snapshot.repo.dirty).toBe("boolean")
    expect(typeof snapshot.repo.dirtyPaths).toBe("number")
    expect(typeof snapshot.repo.systemTokensEstimate).toBe("number")
    expect(typeof snapshot.reflection.backlogSteps).toBe("number")
    expect(typeof snapshot.reflection.pendingCompaction).toBe("boolean")
    expect(typeof snapshot.reflection.consecutiveFailures).toBe("number")
    expect(snapshot.reflection.activeRun).toEqual({
      runId: "run-2",
      trigger: "manual",
      category: "quick",
      model: "sonnet",
      startedAt: "2026-08-10T01:00:00.000Z",
    })
    expect(snapshot.journal).toEqual({
      sessionId: "session-1",
      totalSteps: 0,
      reflectedSteps: 0,
    })
  })

  test("#given a repo exposing no sized tree, log, or commit count #when a snapshot is built #then only v1 repo fields are present", async () => {
    // given
    const context = await contextFixture()

    // when
    const snapshot = await buildMemorySnapshot(context, "session-1", snapshotDeps(stubRepo()))

    // then
    expect(Object.keys(snapshot.repo).sort()).toEqual([
      "committedAtISO",
      "dirty",
      "dirtyPaths",
      "headSha",
      "headSubject",
      "systemTokensEstimate",
    ])
    expect(snapshot.reflection.lastConsolidationAtISO).toBeUndefined()
  })
})

describe("buildMemorySnapshot repo size fields", () => {
  test("#given a sized tree #when a snapshot is built #then totalBytes, systemBytes, and fileCount come from the whole-tree helper", async () => {
    // given
    const context = await contextFixture()
    let sizedCalls = 0
    const repo = stubRepo({
      lsTreeSized: async () => {
        sizedCalls += 1
        return [
          { path: "system/persona.md", bytes: 40 },
          { path: "notes.md", bytes: 20 },
        ]
      },
    })
    const deps = snapshotDeps(repo)

    // when
    const first = await buildMemorySnapshot(context, "session-1", deps)
    await buildMemorySnapshot(context, "session-1", deps)

    // then
    expect(first.repo.totalBytes).toBe(60)
    expect(first.repo.systemBytes).toBe(40)
    expect(first.repo.fileCount).toBe(2)
    expect(sizedCalls).toBe(1)
  })

  test("#given a sized tree read that throws #when a snapshot is built #then size fields are omitted instead of throwing", async () => {
    // given
    const context = await contextFixture()
    const repo = stubRepo({
      lsTreeSized: async () => {
        throw new Error("ls-tree exploded")
      },
    })

    // when
    const snapshot = await buildMemorySnapshot(context, "session-1", snapshotDeps(repo))

    // then
    expect(snapshot.repo.totalBytes).toBeUndefined()
    expect(snapshot.repo.systemBytes).toBeUndefined()
    expect(snapshot.repo.fileCount).toBeUndefined()
    expect(snapshot.repo.systemTokensEstimate).toBe(0)
  })
})

describe("buildMemorySnapshot entriesToday", () => {
  test("#given commits made today #when a snapshot is built #then entriesToday counts commits since local midnight", async () => {
    // given
    const context = await contextFixture()
    const seen: string[] = []
    const repo = stubRepo({
      countCommitsSince: async (sinceISO) => {
        seen.push(sinceISO)
        return 3
      },
    })

    // when
    const snapshot = await buildMemorySnapshot(context, "session-1", snapshotDeps(repo))

    // then
    expect(snapshot.repo.entriesToday).toBe(3)
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    expect(seen).toEqual([midnight.toISOString()])
  })

  test("#given a commit counter that throws #when a snapshot is built #then entriesToday is omitted", async () => {
    // given
    const context = await contextFixture()
    const repo = stubRepo({
      countCommitsSince: async () => {
        throw new Error("rev-list exploded")
      },
    })

    // when
    const snapshot = await buildMemorySnapshot(context, "session-1", snapshotDeps(repo))

    // then
    expect(snapshot.repo.entriesToday).toBeUndefined()
  })
})

describe("buildMemorySnapshot previousEntryAtISO", () => {
  test("#given a real two-commit repo #when a snapshot is built #then previousEntryAtISO carries the second-newest commit time", async () => {
    // given
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-rpc-two-commit-")))
    tempDirs.push(dir)
    const gitRepo = new GitMemoryRepo({ dir, agentId: "omo-memory-rpc" })
    await gitRepo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "first\n" }] })
    await writeFile(join(dir, "system/persona.md"), "second\n", "utf8")
    await gitRepo.commitWrite(["system/persona.md"], "memory: second entry", {
      agentId: "omo-memory-rpc",
      authorName: "OmO Agent",
    })
    const log = await gitRepo.log({ limit: 2 })
    const context = await contextFixture()

    // when
    const snapshot = await buildMemorySnapshot(
      context,
      "session-1",
      snapshotDeps(createMemoryRpcGitRepo(dir)),
    )

    // then
    expect(log).toHaveLength(2)
    expect(snapshot.repo.previousEntryAtISO).toBe(log[1]!.committedAt)
  })

  test("#given a repo with a single commit #when a snapshot is built #then previousEntryAtISO is omitted", async () => {
    // given
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-rpc-one-commit-")))
    tempDirs.push(dir)
    await new GitMemoryRepo({ dir, agentId: "omo-memory-rpc" }).init({
      seedFiles: [{ relativePath: "system/persona.md", content: "first\n" }],
    })
    const context = await contextFixture()

    // when
    const snapshot = await buildMemorySnapshot(
      context,
      "session-1",
      snapshotDeps(createMemoryRpcGitRepo(dir)),
    )

    // then
    expect(snapshot.repo.previousEntryAtISO).toBeUndefined()
  })
})

describe("buildMemorySnapshot lastConsolidationAtISO", () => {
  test("#given merged and failed completions #when a snapshot is built #then lastConsolidationAtISO is the newest merged finishedAt", async () => {
    // given
    const context = await contextFixture()
    await writeCompletion(context, completion("run-1", "merged", "2026-08-10T01:00:00.000Z"))
    await writeCompletion(context, completion("run-2", "merged", "2026-08-11T05:00:00.000Z"))
    await writeCompletion(context, completion("run-3", "failed", "2026-08-12T09:00:00.000Z"))

    // when
    const snapshot = await buildMemorySnapshot(context, "session-1", snapshotDeps(stubRepo()))

    // then
    expect(snapshot.reflection.lastConsolidationAtISO).toBe("2026-08-11T05:00:00.000Z")
  })

  test("#given only non-merged completions #when a snapshot is built #then lastConsolidationAtISO is omitted", async () => {
    // given
    const context = await contextFixture()
    await writeCompletion(context, completion("run-1", "no_changes", "2026-08-10T01:00:00.000Z"))
    await writeCompletion(context, completion("run-2", "failed", "2026-08-11T05:00:00.000Z"))

    // when
    const snapshot = await buildMemorySnapshot(context, "session-1", snapshotDeps(stubRepo()))

    // then
    expect("lastConsolidationAtISO" in snapshot.reflection).toBe(false)
  })
})
