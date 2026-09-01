import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmEfaultTolerant } from "./teardown.test-support"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { MEMORY_STATUS_KEY, refreshMemoryStatus, type GitRepoForStatus } from "./status"
import { type MemoryFooterTimers } from "./status-live"
import { createMemoryFooterStatusLive } from "./status-live-wiring"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

interface FakeTimers extends MemoryFooterTimers {
  readonly live: () => number
  readonly advance: (ticks: number) => void
}

function fakeTimers(): FakeTimers {
  const handles = new Map<number, () => void>()
  let nextHandle = 1
  return {
    set(callback) {
      const handle = nextHandle
      nextHandle += 1
      handles.set(handle, callback)
      return handle
    },
    clear(handle) {
      handles.delete(handle as number)
    },
    live: () => handles.size,
    advance(ticks) {
      for (let tick = 0; tick < ticks; tick += 1) {
        for (const callback of [...handles.values()]) callback()
      }
    },
  }
}

function recorder() {
  const calls: Array<{ key: string; text: string | undefined }> = []
  return {
    calls,
    ui: {
      setStatus(key: string, text: string | undefined): void {
        calls.push({ key, text })
      },
    },
  }
}

async function contextFixture(identityId = "agent-test"): Promise<MemoryIdentityContext> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-footer-live-")))
  roots.push(root)
  return createMemoryIdentityContext({
    identity: identityId,
    identityPaths: buildIdentityPaths(root, identityId),
    binding: { identity: identityId, repoPathHash: "hash", boundAt: 1 },
  })
}

const NOW = Date.parse("2026-08-10T02:00:00.000Z")

function stubRepo(overrides: Partial<GitRepoForStatus> = {}): GitRepoForStatus {
  return {
    head: async () => "sha-1",
    headCommitTimestamp: async () => Date.parse("2026-08-10T00:00:00.000Z") / 1000,
    lsTree: async () => [],
    show: async () => "",
    status: async () => "",
    ...overrides,
  }
}

describe("memory footer status live wiring", () => {
  test("#given an active run for the bound identity #when frames tick #then the memory key animates reflecting", async () => {
    const context = await contextFixture()
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterStatusLive({
      resolveContext: () => context,
      isActive: () => true,
      timers,
      now: () => NOW,
      createGitRepo: () => stubRepo(),
    })

    live.syncActive("session-1", ui.ui)
    timers.advance(1)

    // Literal glyphs: expectations built from MEMORY_REFLECTING_FRAMES would survive a corrupted table.
    expect(ui.calls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "mem:agent-test ⠋ reflecting" },
      { key: MEMORY_STATUS_KEY, text: "mem:agent-test ⠙ reflecting" },
    ])
    live.dispose()
  })

  test("#given an animating run #when the run stops being active #then the segment line returns", async () => {
    const context = await contextFixture()
    const timers = fakeTimers()
    const ui = recorder()
    let active = true
    const live = createMemoryFooterStatusLive({
      resolveContext: () => context,
      isActive: () => active,
      timers,
      now: () => NOW,
      createGitRepo: () => stubRepo({ status: async () => " M system/persona.md\n" }),
    })

    live.syncActive("session-1", ui.ui)
    timers.advance(2)
    active = false
    live.syncActive("session-1", ui.ui)
    await live.refresh("session-1", ui.ui)

    expect(timers.live()).toBe(0)
    expect(ui.calls.at(-1)).toEqual({ key: MEMORY_STATUS_KEY, text: "mem:agent-test 2h ago*" })
    live.dispose()
  })

  test("#given an unbound session #when activity syncs #then no timer starts and no git runs", async () => {
    const timers = fakeTimers()
    const ui = recorder()
    let repoCalls = 0
    const live = createMemoryFooterStatusLive({
      resolveContext: () => undefined,
      isActive: () => true,
      timers,
      now: () => NOW,
      createGitRepo: () => {
        repoCalls += 1
        return stubRepo()
      },
    })

    live.syncActive("session-1", ui.ui)
    await live.refresh("session-1", ui.ui)
    timers.advance(3)

    expect(timers.live()).toBe(0)
    expect(repoCalls).toBe(0)
    expect(ui.calls).toEqual([])
    live.dispose()
  })

  test("#given an unchanged fingerprint #when settles refresh repeatedly #then git head is read but the footer is published once", async () => {
    const context = await contextFixture()
    const ui = recorder()
    let headReads = 0
    const live = createMemoryFooterStatusLive({
      resolveContext: () => context,
      isActive: () => false,
      timers: fakeTimers(),
      now: () => NOW,
      createGitRepo: () => stubRepo({
        head: async () => {
          headReads += 1
          return "sha-1"
        },
      }),
    })

    await live.refresh("session-1", ui.ui)
    await live.refresh("session-1", ui.ui)
    await live.refresh("session-1", ui.ui)

    expect(ui.calls).toHaveLength(1)
    expect(headReads).toBeGreaterThan(1)
    live.dispose()
  })

  test("#given a cached footer #when HEAD moves #then the stale line is replaced", async () => {
    const context = await contextFixture()
    const ui = recorder()
    let head = "sha-1"
    let committedAt = Date.parse("2026-08-10T00:00:00.000Z") / 1000
    const live = createMemoryFooterStatusLive({
      resolveContext: () => context,
      isActive: () => false,
      timers: fakeTimers(),
      now: () => NOW,
      createGitRepo: () => stubRepo({
        head: async () => head,
        headCommitTimestamp: async () => committedAt,
      }),
    })

    await live.refresh("session-1", ui.ui)
    head = "sha-2"
    committedAt = Date.parse("2026-08-10T01:30:00.000Z") / 1000
    await live.refresh("session-1", ui.ui)

    expect(ui.calls.map((call) => call.text)).toEqual([
      "mem:agent-test 2h ago",
      "mem:agent-test 30m ago",
    ])
    live.dispose()
  })

  test("#given an animating run #when the footer is stopped #then no further status calls arrive", async () => {
    const context = await contextFixture()
    const timers = fakeTimers()
    const ui = recorder()
    const live = createMemoryFooterStatusLive({
      resolveContext: () => context,
      isActive: () => true,
      timers,
      now: () => NOW,
      createGitRepo: () => stubRepo(),
    })

    live.syncActive("session-1", ui.ui)
    timers.advance(2)
    const before = ui.calls.length

    live.stop()

    expect(timers.live()).toBe(0)
    timers.advance(10)
    expect(ui.calls).toHaveLength(before)
    live.dispose()
  })

  test("#given the same HEAD timestamp #when both footer surfaces render #then the live wiring uses the status.ts age string", async () => {
    const context = await contextFixture()
    const statusCalls: Array<{ key: string; text: string | undefined }> = []
    await refreshMemoryStatus({
      context,
      ui: {
        setStatus: (key, text) => statusCalls.push({ key, text }),
        notify: () => {},
      },
      compileWarnTokens: 30000,
      alreadyNotified: false,
      gitRepo: stubRepo(),
      now: () => NOW,
    })

    const ui = recorder()
    const live = createMemoryFooterStatusLive({
      resolveContext: () => context,
      isActive: () => false,
      timers: fakeTimers(),
      now: () => NOW,
      createGitRepo: () => stubRepo(),
    })
    await live.refresh("session-1", ui.ui)

    expect(ui.calls).toEqual(statusCalls)
    live.dispose()
  })

  test("#given a repo with no HEAD #when refresh runs #then nothing is published", async () => {
    const context = await contextFixture()
    const ui = recorder()
    const live = createMemoryFooterStatusLive({
      resolveContext: () => context,
      isActive: () => false,
      timers: fakeTimers(),
      now: () => NOW,
      createGitRepo: () => stubRepo({ head: async () => null }),
    })

    await live.refresh("session-1", ui.ui)

    expect(ui.calls).toEqual([])
    live.dispose()
  })
})
