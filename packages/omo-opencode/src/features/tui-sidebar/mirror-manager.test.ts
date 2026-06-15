import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { HEARTBEAT_MS, WRITE_DEBOUNCE_MS } from "./constants"
import { readMirror } from "./mirror-io"
import { TuiStateMirror } from "./mirror-manager"
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
      messages: async ({ path }) => ({
        data: [
          {
            id: `${path.id}-message`,
            agent: path.id === "ses-main" ? "Sisyphus" : "Atlas",
            info: { agent: path.id === "ses-main" ? "Sisyphus" : "Atlas", time: { created: 1 } },
            parts: [{ type: "text" }],
          },
        ],
      }),
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
}): TuiStateMirror {
  const projectDir = input?.projectDir ?? makeTempDir("project")
  return new TuiStateMirror({
    client: input?.client ?? createClient({}),
    projectDir,
    backgroundManager: input?.backgroundManager ?? createBackgroundManager([]),
  })
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
    const client: FakeClient = {
      session: {
        status: async () => {
          throw new Error("status unavailable")
        },
        messages: async () => ({ data: [] }),
      },
    }
    const mirror = createMirror({ projectDir, client })

    // when
    await expect(mirror.flush()).resolves.toBeUndefined()

    // then
    expect(readMirror(projectDir)).toBeNull()
  })

  it("#given concurrent flush calls #when the first build is in flight #then it does not double-build", async () => {
    jest.useFakeTimers()
    // given
    const projectDir = makeTempDir("concurrent-project")
    let buildCount = 0
    let releaseBuild: () => void = () => undefined
    const mirror = createMirror({
      projectDir,
      client: {
        session: {
          status: async () => {
            buildCount += 1
            await new Promise<void>((resolvePromise) => {
              releaseBuild = resolvePromise
            })
            return { data: { "ses-main": { type: "busy" } } }
          },
          messages: async () => ({ data: [] }),
        },
      },
    })

    // when
    const firstFlush = mirror.flush()
    const secondFlush = mirror.flush()
    jest.advanceTimersByTime(WRITE_DEBOUNCE_MS)
    await Promise.resolve()
    releaseBuild()
    await Promise.all([firstFlush, secondFlush])

    // then
    expect(buildCount).toBe(1)
  })
})
