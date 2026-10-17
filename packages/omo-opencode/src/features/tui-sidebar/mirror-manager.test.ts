import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { HEARTBEAT_MS, WRITE_DEBOUNCE_MS } from "./constants"
import { readMirror, resetReaderLeaseThrottle, touchReaderLease } from "./mirror-io"
import { TuiStateMirror } from "./mirror-manager"
import type { SessionAgentResolver } from "./snapshot-builder"
import type { BackgroundTaskSnapshot } from "../background-agent/types"

type StatusRow = { readonly type: string }
type StatusMap = Record<string, StatusRow>

type FakeClient = {
  readonly session: {
    readonly status: () => Promise<{ readonly data: StatusMap }>
    readonly messages: (input: { readonly path: { readonly id: string } }) => Promise<unknown>
  }
}

type FakeBackgroundManager = {
  readonly getTasksSnapshot: () => readonly BackgroundTaskSnapshot[]
}

const originalXdgDataHome = process.env.XDG_DATA_HOME
const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `omo-tui-mirror-manager-${label}-`))
  tempDirs.push(dir)
  return dir
}

function restoreXdgDataHome(): void {
  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME
    return
  }
  process.env.XDG_DATA_HOME = originalXdgDataHome
}

function createClient(statuses: StatusMap): FakeClient {
  return {
    session: {
      status: async () => ({ data: statuses }),
      messages: async () => ({ data: [] }),
    },
  }
}

function createBackgroundManager(tasks: readonly BackgroundTaskSnapshot[]): FakeBackgroundManager {
  return {
    getTasksSnapshot: () => tasks,
  }
}

function createMirror(input?: {
  readonly client?: FakeClient
  readonly projectDir?: string
  readonly backgroundManager?: FakeBackgroundManager
  readonly sessionAgentResolver?: SessionAgentResolver
  readonly reportFlushError?: (error: Error) => void
  readonly isReaderActive?: () => boolean
}): TuiStateMirror {
  const projectDir = input?.projectDir ?? makeTempDir("project")
  return new TuiStateMirror({
    client: input?.client ?? createClient({}),
    projectDir,
    backgroundManager: input?.backgroundManager ?? createBackgroundManager([]),
    sessionAgentResolver: input?.sessionAgentResolver ?? resolveTestSessionAgent,
    reportFlushError: input?.reportFlushError,
    isReaderActive: input?.isReaderActive,
  })
}

const resolveTestSessionAgent: SessionAgentResolver = async (sessionID) => {
  switch (sessionID) {
    case "ses-main":
      return "sisyphus"
    case "ses-sub":
      return "atlas"
    default:
      return null
  }
}

describe("TuiStateMirror", () => {
  beforeEach(() => {
    process.env.XDG_DATA_HOME = makeTempDir("xdg")
  })

  afterEach(() => {
    jest.useRealTimers()
    restoreXdgDataHome()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("#given a mirror manager #when flushing #then it writes a readable mirror", async () => {
    // given
    const projectDir = makeTempDir("flush-project")
    const mirror = createMirror({
      projectDir,
      client: createClient({ "ses-main": { type: "running" } }),
    })

    // when
    await mirror.flush()

    // then
    expect(readMirror(projectDir)?.activeAgents).toEqual([{ name: "sisyphus", status: "running" }])
  })

  it("#given a started mirror #when heartbeat fires without events #then it writes the mirror", async () => {
    jest.useFakeTimers()
    // given
    const projectDir = makeTempDir("heartbeat-project")
    const mirror = createMirror({
      projectDir,
      client: createClient({ "ses-main": { type: "busy" } }),
      isReaderActive: () => true,
    })
    mirror.start()

    // when
    jest.advanceTimersByTime(HEARTBEAT_MS)
    const heartbeatWrite = mirror.flush()
    jest.advanceTimersByTime(WRITE_DEBOUNCE_MS)
    await heartbeatWrite

    // then
    expect(readMirror(projectDir)?.activeAgents).toEqual([{ name: "sisyphus", status: "busy" }])
    mirror.stop()
  })

  it("#given no TUI reader #when the heartbeat fires #then it neither builds nor writes the mirror (local fix 48)", async () => {
    jest.useFakeTimers()
    // given
    const projectDir = makeTempDir("idle-project")
    let builds = 0
    const client = createClient({ "ses-main": { type: "busy" } })
    const counting: FakeClient = { session: { ...client.session, status: async () => { builds++; return client.session.status() } } }
    const mirror = createMirror({ projectDir, client: counting, isReaderActive: () => false })
    mirror.start()

    // when
    for (let i = 0; i < 5; i++) jest.advanceTimersByTime(HEARTBEAT_MS + WRITE_DEBOUNCE_MS)
    jest.useRealTimers()
    await new Promise((resolve) => setTimeout(resolve, 10))

    // then
    expect(builds).toBe(0)
    expect(readMirror(projectDir)).toBeNull()
    mirror.stop()
  })

  it("#given no TUI reader #when an event arrives #then the mirror is still flushed (local fix 48)", async () => {
    jest.useFakeTimers()
    // given
    const projectDir = makeTempDir("event-project")
    const mirror = createMirror({ projectDir, client: createClient({ "ses-main": { type: "running" } }), isReaderActive: () => false })
    mirror.start()

    // when
    mirror.onEvent({ type: "session.status" })
    const write = mirror.flush()
    jest.advanceTimersByTime(WRITE_DEBOUNCE_MS)
    await write

    // then
    expect(readMirror(projectDir)?.activeAgents).toEqual([{ name: "sisyphus", status: "running" }])
    mirror.stop()
  })

  it("#given the default reader check #when a TUI touches the lease #then the heartbeat writes again (local fix 48)", async () => {
    // given (real timers: the default check stats the lease file next to the mirror)
    const projectDir = makeTempDir("lease-project")
    const mirror = createMirror({ projectDir, client: createClient({ "ses-main": { type: "busy" } }) })
    mirror.start()
    await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS + WRITE_DEBOUNCE_MS + 400))
    expect(readMirror(projectDir)).toBeNull()

    // when
    resetReaderLeaseThrottle()
    touchReaderLease(projectDir)
    await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS + WRITE_DEBOUNCE_MS + 400))

    // then
    expect(readMirror(projectDir)?.activeAgents).toEqual([{ name: "sisyphus", status: "busy" }])
    mirror.stop()
  }, 15_000)

  it("#given a started mirror #when started #then heartbeat handle is unref'd", () => {
    jest.useFakeTimers()
    const mirror = createMirror()
    const unref = jest.fn()
    const originalSetInterval = globalThis.setInterval
    globalThis.setInterval = jest.fn(() => ({ unref })) as unknown as typeof setInterval

    try {
      mirror.start()
      expect(unref).toHaveBeenCalledTimes(1)
    } finally {
      mirror.stop()
      globalThis.setInterval = originalSetInterval
    }
  })

  it("#given a started mirror #when stopped #then timers are cleared and no later write occurs", async () => {
    jest.useFakeTimers()
    // given
    const projectDir = makeTempDir("stop-project")
    const mirror = createMirror({
      projectDir,
      client: createClient({ "ses-main": { type: "busy" } }),
    })
    mirror.start()

    // when
    mirror.stop()
    jest.advanceTimersByTime(HEARTBEAT_MS)
    await Promise.resolve()
    jest.advanceTimersByTime(WRITE_DEBOUNCE_MS)
    await Promise.resolve()

    // then
    expect(readMirror(projectDir)).toBeNull()
    mirror.stop()
  })

  it("#given client status throws #when flushing #then status throws no-op with no rejection and no mirror write", async () => {
    // given
    const projectDir = makeTempDir("throw-project")
    const statusError = new Error("status unavailable")
    const reportedErrors: Error[] = []
    const client: FakeClient = {
      session: {
        status: async () => {
          throw statusError
        },
        messages: async () => ({ data: [] }),
      },
    }
    const mirror = createMirror({
      projectDir,
      client,
      reportFlushError: (error) => {
        reportedErrors.push(error)
      },
    })

    // when
    await expect(mirror.flush()).resolves.toBeUndefined()

    // then
    expect(readMirror(projectDir)).toBeNull()
    expect(reportedErrors).toEqual([statusError])
  })

  it("#given mirror write fails #when flushing #then the write error is reported", async () => {
    // given
    const blockedDataHome = join(makeTempDir("blocked-parent"), "data-home-file")
    writeFileSync(blockedDataHome, "not a directory", "utf-8")
    process.env.XDG_DATA_HOME = blockedDataHome
    const projectDir = makeTempDir("write-failure")
    const reportedErrors: Error[] = []
    const mirror = createMirror({
      projectDir,
      client: createClient({ "ses-main": { type: "running" } }),
      reportFlushError: (error) => {
        reportedErrors.push(error)
      },
    })

    // when
    await expect(mirror.flush()).resolves.toBeUndefined()

    // then
    expect(reportedErrors).toHaveLength(1)
    expect(reportedErrors[0]?.message).toContain("not a directory")
  })

  it("#given concurrent flush calls #when the first build is in flight #then it does not double-build", async () => {
    // given: real timers; the 250ms debounce elapses on its own, and the test
    // subscribes to the actual build start instead of assuming microtask counts
    // (the fake-timer + single-tick version of this test deadlocked on CI).
    const projectDir = makeTempDir("concurrent-project")
    let buildCount = 0
    let releaseBuilds: () => void = () => undefined
    let reportBuildStarted: () => void = () => undefined
    const buildGate = new Promise<void>((resolvePromise) => {
      releaseBuilds = resolvePromise
    })
    const buildStarted = new Promise<void>((resolvePromise) => {
      reportBuildStarted = resolvePromise
    })
    const mirror = createMirror({
      projectDir,
      client: {
        session: {
          status: async () => {
            buildCount += 1
            reportBuildStarted()
            await buildGate
            return { data: { "ses-main": { type: "busy" } } }
          },
          messages: async () => ({ data: [] }),
        },
      },
    })

    // when
    const firstFlush = mirror.flush()
    const secondFlush = mirror.flush()
    await buildStarted
    releaseBuilds()
    await Promise.all([firstFlush, secondFlush])

    // then
    expect(buildCount).toBe(1)
  })
})
