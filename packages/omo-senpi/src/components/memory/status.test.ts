import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

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
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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

function segmentRepo(overrides: Partial<GitRepoForStatus> = {}): GitRepoForStatus {
  return {
    head: async () => "abcdef1234567890",
    headCommitTimestamp: async () => Date.parse("2026-08-10T00:00:00.000Z") / 1000,
    lsTree: async () => [],
    show: async () => "",
    status: async () => "",
    ...overrides,
  }
}

function segmentContext(input: {
  readonly identity?: string
  readonly sessionId?: string
  readonly backlogSteps?: number
  readonly failures?: number
}) {
  const identity = input.identity ?? "fake-agent"
  const root = mkdtempSync(join(tmpdir(), "omo-memory-segments-"))
  roots.push(root)
  const paths = buildIdentityPaths(root, identity)
  if (input.sessionId !== undefined && input.backlogSteps !== undefined) {
    const stateDir = join(paths.transcripts, input.sessionId)
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      join(stateDir, "state.json"),
      JSON.stringify({
        schema_version: "v3_assistant_steps",
        total_completed_steps: input.backlogSteps,
        reflected_completed_steps: 0,
        steps_since_last_successful_reflection: input.backlogSteps,
      }),
    )
  }
  for (let index = 0; index < (input.failures ?? 0); index += 1) {
    const completionsDir = join(paths.reflection, "completions")
    mkdirSync(completionsDir, { recursive: true })
    writeFileSync(
      join(completionsDir, `run-${index}.json`),
      JSON.stringify({
        schemaVersion: 1,
        runId: `run-${index}`,
        outcome: "failed",
        reason: "spawn_failed",
        detail: "boom",
        finishedAt: new Date(Date.now() - ((input.failures ?? 0) - index) * 60_000).toISOString(),
        delivery: { status: "consumed" },
      }),
    )
  }
  return createMemoryIdentityContext({
    identity,
    identityPaths: paths,
    binding: { identity, repoPathHash: "hash", boundAt: 1 },
  })
}

const SEGMENT_NOW = Date.parse("2026-08-10T00:01:30.000Z")

describe("refreshMemoryStatus segments", () => {
  test("#given a dirty memory worktree #when refresh runs #then the footer carries the dirty marker", async () => {
    const context = segmentContext({})
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo({ status: async () => " M system/persona.md\n" }),
      now: () => SEGMENT_NOW,
      checkAdvisory: false,
    })

    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "mem:fake-agent 1m ago*" },
    ])
  }, 30_000)

  test("#given a clean worktree with a backlog of fourteen steps #when refresh runs #then the backlog segment renders", async () => {
    const context = segmentContext({ sessionId: "session-a", backlogSteps: 14 })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo(),
      now: () => SEGMENT_NOW,
      checkAdvisory: false,
      sessionId: "session-a",
    })

    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "mem:fake-agent 1m ago (+14)" },
    ])
  }, 30_000)

  test("#given a zero backlog #when refresh runs #then no backlog segment renders", async () => {
    const context = segmentContext({ sessionId: "session-a", backlogSteps: 0 })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo(),
      now: () => SEGMENT_NOW,
      checkAdvisory: false,
      sessionId: "session-a",
    })

    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "mem:fake-agent 1m ago" },
    ])
  }, 30_000)

  test("#given three consecutive reflection failures #when refresh runs #then the streak badge renders", async () => {
    const context = segmentContext({ failures: 3 })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo(),
      now: () => SEGMENT_NOW,
      checkAdvisory: false,
    })

    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "mem:fake-agent 1m ago !3" },
    ])
  }, 30_000)

  test("#given only two consecutive failures #when refresh runs #then no streak badge renders", async () => {
    const context = segmentContext({ failures: 2 })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo(),
      now: () => SEGMENT_NOW,
      checkAdvisory: false,
    })

    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "mem:fake-agent 1m ago" },
    ])
  }, 30_000)

  test("#given dirty, backlog, and streak all present #when refresh runs #then segments render in fixed order", async () => {
    const context = segmentContext({
      identity: "agent",
      sessionId: "session-a",
      backlogSteps: 7,
      failures: 3,
    })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo({ status: async () => "?? scratch.md\n" }),
      now: () => SEGMENT_NOW,
      checkAdvisory: false,
      sessionId: "session-a",
    })

    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "mem:agent 1m ago* (+7) !3" },
    ])
  }, 30_000)

  test("#given an assembled line over sixty characters #when refresh runs #then segments drop right to left until it fits", async () => {
    const identity = "a".repeat(45)
    const context = segmentContext({ identity, sessionId: "session-a", backlogSteps: 7, failures: 3 })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo({ status: async () => "?? scratch.md\n" }),
      now: () => SEGMENT_NOW,
      checkAdvisory: false,
      sessionId: "session-a",
    })

    // base `mem:<45 chars> 1m ago` is 56; `*` fits at 57, `* (+7)` would be 62.
    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: `mem:${identity} 1m ago*` },
    ])
    expect(recorder.statusCalls[0]?.text?.length).toBeLessThanOrEqual(60)
  }, 30_000)

  test("#given a base line already past the width budget #when refresh runs #then every segment drops", async () => {
    const identity = "b".repeat(54)
    const context = segmentContext({ identity, sessionId: "session-a", backlogSteps: 7, failures: 3 })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo({ status: async () => "?? scratch.md\n" }),
      now: () => SEGMENT_NOW,
      checkAdvisory: false,
      sessionId: "session-a",
    })

    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: `mem:${identity} 1m ago` },
    ])
  }, 30_000)

  test("#given a repo with no HEAD #when refresh runs #then no git status work happens", async () => {
    const context = segmentContext({ sessionId: "session-a", backlogSteps: 9 })
    const recorder = recordingUi()
    let statusCalls = 0

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo({
        head: async () => null,
        status: async () => {
          statusCalls += 1
          return " M x"
        },
      }),
      now: () => SEGMENT_NOW,
      sessionId: "session-a",
    })

    expect(statusCalls).toBe(0)
    expect(recorder.statusCalls).toEqual([])
  }, 30_000)

  test("#given footer rendering disabled #when refresh runs #then no git status call happens", async () => {
    const context = segmentContext({ sessionId: "session-a", backlogSteps: 9 })
    const recorder = recordingUi()
    let statusCalls = 0

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo({
        status: async () => {
          statusCalls += 1
          return " M x"
        },
      }),
      now: () => SEGMENT_NOW,
      showFooter: false,
      checkAdvisory: false,
      sessionId: "session-a",
    })

    expect(statusCalls).toBe(0)
    expect(recorder.statusCalls).toEqual([])
  }, 30_000)

  test("#given a future commit timestamp with dirty state #when refresh runs #then the future-age guard still suppresses the footer", async () => {
    const context = segmentContext({})
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo({
        headCommitTimestamp: async () => Date.parse("2026-08-10T00:02:00.000Z") / 1000,
        status: async () => " M x",
      }),
      now: () => SEGMENT_NOW,
      checkAdvisory: false,
    })

    expect(recorder.statusCalls).toEqual([])
  }, 30_000)

  test("#given git status throws #when refresh runs #then the base footer still renders", async () => {
    const context = segmentContext({})
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 30_000,
      alreadyNotified: false,
      gitRepo: segmentRepo({
        status: async () => {
          throw new Error("git exploded")
        },
      }),
      now: () => SEGMENT_NOW,
      checkAdvisory: false,
    })

    expect(recorder.statusCalls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "mem:fake-agent 1m ago" },
    ])
  }, 30_000)
})

describe("refreshMemoryStatus", () => {
  test("#given a committed HEAD ninety seconds old #when refresh runs #then footer shows system-clock-relative age", async () => {
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => Date.parse("2026-08-10T00:00:00.000Z") / 1000,
      lsTree: async () => [],
      show: async () => "",
      status: async () => "",
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
  }, 30_000)

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
        status: async () => "",
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
  }, 30_000)

  test("#given system memory exactly at the soft pressure threshold #when refresh runs #then one pressure dream request fires without changing the advisory notify", async () => {
    const pressureRequests: number[] = []
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => null,
      lsTree: async () => ["system/persona.md"],
      show: async () => "P".repeat(320),
      status: async () => "",
    }
    const context = createMemoryIdentityContext({
      identity: "pressure-agent",
      identityPaths: buildIdentityPaths("/tmp/nonexistent", "pressure-agent"),
      binding: { identity: "pressure-agent", repoPathHash: "hash", boundAt: 1 },
    })
    const recorder = recordingUi()

    await refreshMemoryStatus({
      context,
      ui: recorder.ui,
      compileWarnTokens: 100,
      alreadyNotified: false,
      gitRepo: fakeRepo,
      requestPressureDream: async () => { pressureRequests.push(1) },
    })

    expect(pressureRequests).toHaveLength(1)
    expect(recorder.notifications).toEqual([])
  })

  test("#given system memory below the soft pressure threshold #when refresh runs #then no pressure dream request fires", async () => {
    const pressureRequests: number[] = []
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => null,
      lsTree: async () => ["system/persona.md"],
      show: async () => "P".repeat(316),
      status: async () => "",
    }
    const context = createMemoryIdentityContext({
      identity: "pressure-agent",
      identityPaths: buildIdentityPaths("/tmp/nonexistent", "pressure-agent"),
      binding: { identity: "pressure-agent", repoPathHash: "hash", boundAt: 1 },
    })

    await refreshMemoryStatus({
      context,
      ui: recordingUi().ui,
      compileWarnTokens: 100,
      alreadyNotified: false,
      gitRepo: fakeRepo,
      requestPressureDream: async () => { pressureRequests.push(1) },
    })

    expect(pressureRequests).toEqual([])
  })

  test("#given pressure advisory work is already deduped #when refresh runs over threshold #then neither estimate-driven path fires again", async () => {
    const calls = { tree: 0, pressure: 0 }
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => null,
      lsTree: async () => { calls.tree += 1; return ["system/persona.md"] },
      show: async () => "P".repeat(400),
      status: async () => "",
    }
    const context = createMemoryIdentityContext({
      identity: "pressure-agent",
      identityPaths: buildIdentityPaths("/tmp/nonexistent", "pressure-agent"),
      binding: { identity: "pressure-agent", repoPathHash: "hash", boundAt: 1 },
    })

    await refreshMemoryStatus({
      context,
      ui: recordingUi().ui,
      compileWarnTokens: 100,
      alreadyNotified: true,
      gitRepo: fakeRepo,
      requestPressureDream: async () => { calls.pressure += 1 },
    })

    expect(calls).toEqual({ tree: 0, pressure: 0 })
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
  }, 30_000)

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
  }, 30_000)

  test("#given footer rendering disabled at session bind #when memory is oversized #then advisory fires without a footer", async () => {
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => Date.parse("2026-08-10T00:00:00.000Z") / 1000,
      lsTree: async () => ["system/persona.md"],
      show: async () => "oversized memory body",
      status: async () => "",
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
  }, 30_000)

  test("#given advisory checking disabled after first memory use #when memory is oversized #then footer renders without another warning", async () => {
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => Date.parse("2026-08-10T00:00:00.000Z") / 1000,
      lsTree: async () => ["system/persona.md"],
      show: async () => "oversized memory body",
      status: async () => "",
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
  }, 30_000)

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
  }, 30_000)

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
  }, 30_000)

  test("#given a committed HEAD without a readable commit timestamp #when refresh runs #then no footer appears", async () => {
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => null,
      lsTree: async () => ["system/persona.md"],
      show: async () => "persona body",
      status: async () => "",
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
  }, 30_000)

  test("#given a commit timestamp later than the system clock #when refresh runs #then no footer appears", async () => {
    const fakeRepo: GitRepoForStatus = {
      head: async () => "abcdef1234567890",
      headCommitTimestamp: async () => Date.parse("2026-08-10T00:02:00.000Z") / 1000,
      lsTree: async () => [],
      show: async () => "",
      status: async () => "",
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
  }, 30_000)

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
  }, 30_000)
})
