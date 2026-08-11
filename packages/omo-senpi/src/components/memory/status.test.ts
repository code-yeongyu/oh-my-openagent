import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext } from "./context"
import {
  MEMORY_STATUS_KEY,
  refreshMemoryStatus,
  type GitRepoForStatus,
  type MemoryStatusUi,
} from "./status"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface RecordingUi {
  readonly statusCalls: Array<{ key: string; text: string | undefined }>
  readonly notifications: Array<{ message: string; level: string }>
  readonly ui: MemoryStatusUi
}

function recordingUi(): RecordingUi {
  const statusCalls: Array<{ key: string; text: string | undefined }> = []
  const notifications: Array<{ message: string; level: string }> = []
  return {
    statusCalls,
    notifications,
    ui: {
      setStatus: (key, text) => statusCalls.push({ key, text }),
      notify: (message, level) => notifications.push({ message, level }),
    },
  }
}

interface FixtureRepo {
  readonly repoPath: string
  readonly repo: GitMemoryRepo
}

async function createFixtureRepo(
  seedFiles: ReadonlyArray<{ relativePath: string; content: string }>,
): Promise<FixtureRepo> {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-status-"))
  roots.push(root)
  const paths = buildIdentityPaths(root, "agent-test-id")
  const repo = new GitMemoryRepo({ dir: paths.repo, agentId: "agent-test" })
  await repo.init({
    authorName: "Test Agent",
    seedFiles: [...seedFiles],
  })
  return { repoPath: paths.repo, repo }
}

function contextFor(repoPath: string, identity = "agent-test-id") {
  const paths = buildIdentityPaths(
    join(repoPath, "..", "..", ".."),
    identity,
  )
  return createMemoryIdentityContext({
    identity,
    identityPaths: { ...paths, repo: repoPath },
    binding: { identity, repoPathHash: "hash", boundAt: 1 },
  })
}

describe("refreshMemoryStatus", () => {
  test("#given a committed HEAD ninety seconds old #when refresh runs #then footer shows system-clock-relative age", async () => {
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => Date.parse("2026-08-10T00:00:00.000Z") / 1000,
      lsTree: async () => [],
      show: async () => "",
    }
    const context = createMemoryIdentityContext({
      identity: "fake-agent",
      identityPaths: buildIdentityPaths("/tmp/nonexistent", "fake-agent"),
      binding: { identity: "fake-agent", repoPathHash: "hash", boundAt: 1 },
    })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30000,
      alreadyNotified: false,
      gitRepo: fakeRepo,
      now: () => Date.parse("2026-08-10T00:01:30.000Z"),
    })

    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "mem:fake-agent 1m ago" },
    ])
  })

  test("#given committed HEAD ages across display buckets #when refresh runs #then compact labels follow the system clock", async () => {
    const now = Date.parse("2026-08-10T12:00:00.000Z")
    for (const [ageMs, expected] of [
      [30_000, "just now"],
      [2 * 60 * 60_000, "2h ago"],
      [3 * 24 * 60 * 60_000, "3d ago"],
    ] as const) {
      const fakeRepo: GitRepoForStatus = {
        head: async () => "abcdef1234567890",
        headCommitTimestamp: async () => (now - ageMs) / 1000,
        lsTree: async () => [],
        show: async () => "",
      }
      const context = createMemoryIdentityContext({
        identity: "fake-agent",
        identityPaths: buildIdentityPaths("/tmp/nonexistent", "fake-agent"),
        binding: { identity: "fake-agent", repoPathHash: "hash", boundAt: 1 },
      })
      const recorder = recordingUi()

      await refreshMemoryStatus({
        context,
        ui: recorder.ui,
        compileWarnTokens: 30_000,
        alreadyNotified: false,
        gitRepo: fakeRepo,
        now: () => now,
      })

      expect(recorder.statusCalls).toEqual([
        { key: MEMORY_STATUS_KEY, text: `mem:fake-agent ${expected}` },
      ])
    }
  })

  test("#given system markdown under the advisory threshold #when refresh runs #then no advisory notify fires", async () => {
    const smallContent = "x".repeat(100)
    const { repoPath } = await createFixtureRepo([
      { relativePath: "system/persona.md", content: smallContent },
      { relativePath: "system/notes.md", content: smallContent },
    ])
    const context = contextFor(repoPath)
    const recorder = recordingUi()

    const result = await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30000,
      alreadyNotified: false,
    })

    expect(recorder.notifications).toEqual([])
    expect(result.notified).toBe(false)
  })

  test("#given system markdown at or above the advisory threshold #when refresh runs #then one warning notify fires with token estimate", async () => {
    const bigContent = "A".repeat(120_000)
    const { repoPath } = await createFixtureRepo([
      { relativePath: "system/persona.md", content: bigContent },
      { relativePath: "system/extra.md", content: bigContent },
    ])
    const context = contextFor(repoPath)
    const recorder = recordingUi()

    const result = await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
    })

    expect(recorder.notifications).toHaveLength(1)
    expect(recorder.notifications[0]?.level).toBe("warning")
    expect(recorder.notifications[0]?.message).toContain("system memory")
    expect(recorder.notifications[0]?.message).toContain("tokens")
    expect(recorder.notifications[0]?.message).toContain("/doctor")
    expect(result.notified).toBe(true)
  })

  test("#given footer rendering disabled at session bind #when memory is oversized #then advisory fires without a footer", async () => {
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => Date.parse("2026-08-10T00:00:00.000Z") / 1000,
      lsTree: async () => ["system/persona.md"],
      show: async () => "oversized memory body",
    }
    const context = createMemoryIdentityContext({
      identity: "fake-agent",
      identityPaths: buildIdentityPaths("/tmp/nonexistent", "fake-agent"),
      binding: { identity: "fake-agent", repoPathHash: "hash", boundAt: 1 },
    })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 1,
      alreadyNotified: false,
      gitRepo: fakeRepo,
      now: () => Date.parse("2026-08-10T00:01:30.000Z"),
      showFooter: false,
    })

    expect(recorder.statusCalls).toEqual([])
    expect(recorder.notifications).toHaveLength(1)
  })

  test("#given advisory checking disabled after first memory use #when memory is oversized #then footer renders without another warning", async () => {
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => Date.parse("2026-08-10T00:00:00.000Z") / 1000,
      lsTree: async () => ["system/persona.md"],
      show: async () => "oversized memory body",
    }
    const context = createMemoryIdentityContext({
      identity: "fake-agent",
      identityPaths: buildIdentityPaths("/tmp/nonexistent", "fake-agent"),
      binding: { identity: "fake-agent", repoPathHash: "hash", boundAt: 1 },
    })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 1,
      alreadyNotified: false,
      gitRepo: fakeRepo,
      now: () => Date.parse("2026-08-10T00:01:30.000Z"),
      checkAdvisory: false,
    })

    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "mem:fake-agent 1m ago" },
    ])
    expect(recorder.notifications).toEqual([])
  })

  test("#given an already-notified session #when refresh runs again over threshold #then no second notify fires", async () => {
    const bigContent = "B".repeat(120_000)
    const { repoPath } = await createFixtureRepo([
      { relativePath: "system/persona.md", content: bigContent },
    ])
    const context = contextFor(repoPath)
    const recorder = recordingUi()

    const result = await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: true,
    })

    expect(recorder.notifications).toEqual([])
    expect(result.notified).toBe(false)
  })

  test("#given a repo with no HEAD #when refresh runs #then no footer or advisory appears", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-memory-status-empty-"))
    roots.push(root)
    const paths = buildIdentityPaths(root, "agent-empty")
    const context = createMemoryIdentityContext({
      identity: "agent-empty",
      identityPaths: paths,
      binding: { identity: "agent-empty", repoPathHash: "hash", boundAt: 1 },
    })
    const recorder = recordingUi()

    const result = await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
    })

    expect(recorder.statusCalls).toEqual([])
    expect(recorder.notifications).toEqual([])
    expect(result.notified).toBe(false)
  })

  test("#given a committed HEAD without a readable commit timestamp #when refresh runs #then no footer appears", async () => {
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => null,
      lsTree: async () => ["system/persona.md"],
      show: async () => "persona body",
    }
    const context = createMemoryIdentityContext({
      identity: "fake-agent",
      identityPaths: buildIdentityPaths("/tmp/nonexistent", "fake-agent"),
      binding: { identity: "fake-agent", repoPathHash: "hash", boundAt: 1 },
    })
    const recorder = recordingUi()

    const result = await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: fakeRepo,
    })

    expect(recorder.statusCalls).toEqual([])
    expect(result.notified).toBe(false)
  })

  test("#given a commit timestamp later than the system clock #when refresh runs #then no footer appears", async () => {
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => Date.parse("2026-08-10T00:02:00.000Z") / 1000,
      lsTree: async () => [],
      show: async () => "",
    }
    const context = createMemoryIdentityContext({
      identity: "fake-agent",
      identityPaths: buildIdentityPaths("/tmp/nonexistent", "fake-agent"),
      binding: { identity: "fake-agent", repoPathHash: "hash", boundAt: 1 },
    })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: fakeRepo,
      now: () => Date.parse("2026-08-10T00:01:30.000Z"),
    })

    expect(recorder.statusCalls).toEqual([])
  })

  test("#given system files with non-system markdown excluded #when refresh estimates tokens #then only system/**/*.md counts", async () => {
    const content = "C".repeat(200_000)
    const { repoPath } = await createFixtureRepo([
      { relativePath: "system/persona.md", content },
      { relativePath: "notes.md", content },
      { relativePath: "journal/entry.md", content },
    ])
    const context = contextFor(repoPath)
    const recorder = recordingUi()

    const result = await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
    })

    expect(result.notified).toBe(true)
    const message = recorder.notifications[0]?.message ?? ""
    const match = message.match(/~(\d+)/)
    const estimate = match ? Number(match[1]) : NaN
    expect(estimate).toBeGreaterThanOrEqual(30_000)
    expect(estimate).toBeLessThanOrEqual(50_001)
  })
})
