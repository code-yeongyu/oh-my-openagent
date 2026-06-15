import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { LOOP_FRESH_MS } from "./constants"
import { buildTuiRuntimeSnapshot } from "./snapshot-builder"
import { TuiRuntimeSnapshotSchema } from "./snapshot-schema"
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

const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `omo-tui-snapshot-builder-${label}-`))
  tempDirs.push(dir)
  return dir
}

function writeLiveLoop(projectDir: string): void {
  const filePath = join(projectDir, ".omo", "ulw-loop", "current", "goals.json")
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      activeGoalId: "ship",
      goals: [
        {
          id: "ship",
          title: "Ship mirror",
          status: "in_progress",
          successCriteria: [{ status: "pass" }, { status: "fail" }],
        },
      ],
    }),
  )
}

function writeSensitiveLiveLoop(projectDir: string): void {
  const filePath = join(projectDir, ".omo", "ulw-loop", "current", "goals.json")
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      activeGoalId: "secret",
      goals: [
        {
          id: "secret",
          title: "Deploy with token sk-live-secret",
          status: "in_progress",
          successCriteria: [{ status: "pending" }],
        },
      ],
    }),
  )
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

describe("buildTuiRuntimeSnapshot", () => {
  beforeEach(() => {
    makeTempDir("isolation")
  })

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("#given SDK data statuses background jobs and a live loop #when building #then it returns a schema-valid runtime snapshot", async () => {
    // given
    const projectDir = makeTempDir("schema-project")
    writeLiveLoop(projectDir)

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({
        "ses-main": { type: "busy" },
        "ses-idle": { type: "idle" },
        "ses-sub": { type: "retry" },
      }),
      backgroundManager: createBackgroundManager([
        {
          title: "Explore runtime",
          status: "running",
          toolCalls: 3,
          lastTool: "grep",
          agent: "sisyphus",
        },
      ]),
      sessionAgentResolver: resolveTestSessionAgent,
    })

    // then
    expect(TuiRuntimeSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot.projectDir).toBe(resolve(projectDir))
    expect(snapshot.activeAgents).toEqual([
      { name: "sisyphus", status: "busy" },
      { name: "atlas", status: "retry" },
    ])
    expect(snapshot.jobBoard).toEqual([
      { title: "sisyphus background task", status: "running", toolCalls: 3, lastTool: "grep" },
    ])
    expect(snapshot.loop).toEqual({
      kind: "live",
      goalsDone: 0,
      goalsTotal: 1,
      pass: 1,
      fail: 1,
      pending: 0,
      blocked: 0,
      activeGoal: null,
    })
    expect(Date.now() - snapshot.updatedAt).toBeLessThan(LOOP_FRESH_MS)
  })

  it("#given no session agent is available #when building #then it uses the session id fallback explicitly", async () => {
    // given
    const projectDir = makeTempDir("fallback-project")

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: {
        session: {
          status: async () => ({ data: { "ses-fallback": { type: "running" } } }),
          messages: async () => ({ data: [] }),
        },
      },
      backgroundManager: createBackgroundManager([]),
    })

    // then
    expect(snapshot.activeAgents).toEqual([{ name: "ses-fallback", status: "running" }])
  })

  it("#given prompt-derived task and loop titles #when building #then persisted mirror text is redacted", async () => {
    // given
    const projectDir = makeTempDir("sensitive-text")
    writeSensitiveLiveLoop(projectDir)

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({}),
      backgroundManager: createBackgroundManager([
        {
          title: "Read customer secret sk-live-job",
          status: "running",
          toolCalls: 1,
          lastTool: "read",
          agent: "atlas",
        },
      ]),
      sessionAgentResolver: resolveTestSessionAgent,
    })

    // then
    expect(snapshot.loop?.activeGoal).toBeNull()
    expect(snapshot.jobBoard).toEqual([
      { title: "atlas background task", status: "running", toolCalls: 1, lastTool: "read" },
    ])
    expect(JSON.stringify(snapshot)).not.toContain("sk-live")
  })
})
