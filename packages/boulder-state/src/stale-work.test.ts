/// <reference path="../../../bun-test.d.ts" />

import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import {
  appendSessionIdForWork,
  DEFAULT_STALE_WORK_THRESHOLD_MS,
  getBoulderFilePath,
  getWorkResumeOptions,
  isWorkStale,
  readBoulderState,
  reconcileStaleWorks,
  resolveStaleWorkThresholdMs,
  selectActiveWork,
  STALE_WORK_THRESHOLD_ENV_KEY,
} from "./index"

const STALE_WORK_ID = "omo-agent-toolkit-eval-sdk-20260913"
const STALE_SESSION_ID = "senpi:01a09988-f0b5-7e7c-97b2-ea591aa4bdaf"
const STALE_TRANSCRIPT_FILE = "2026-09-13T06-51-23-701Z_01a09988-f0b5-7e7c-97b2-ea591aa4bdaf.jsonl"
const HOUR_MS = 60 * 60 * 1000

// The record observed in a real install: no `updated_at`, no `started_at`, and extra fields the
// ulw-execute writer keeps beside the tracked ones.
function createStaleWorkRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work_id: STALE_WORK_ID,
    active_plan: ".omo/plans/omo-agent-toolkit-eval-sdk.md",
    plan_name: "omo-agent-toolkit-eval-sdk",
    session_ids: [STALE_SESSION_ID],
    status: "active",
    worktree_path: null,
    ulw_loop_session: "01a09988-f0b5-7e7c-97b2-ea591aa4bdaf",
    mode: "--ship",
    ...overrides,
  }
}

function createProject(works: Record<string, unknown>, activeWorkId: string): string {
  const directory = mkdtempSync(join(tmpdir(), "boulder-stale-work-"))
  const boulderDirectory = join(directory, ".omo")
  mkdirSync(boulderDirectory, { recursive: true })
  const activeWork = works[activeWorkId] as Record<string, unknown>
  writeFileSync(
    join(boulderDirectory, "boulder.json"),
    JSON.stringify({
      schema_version: 2,
      active_work_id: activeWorkId,
      works,
      active_plan: activeWork["active_plan"],
      plan_name: activeWork["plan_name"],
      status: activeWork["status"],
      session_ids: activeWork["session_ids"],
    }),
    "utf-8",
  )
  return directory
}

function createSessionsDirectory(): string {
  return mkdtempSync(join(tmpdir(), "boulder-stale-agent-"))
}

function readRawState(directory: string): string {
  return readFileSync(getBoulderFilePath(directory), "utf-8")
}

// Senpi keeps transcripts at <agentDir>/sessions/<encoded session cwd>/<timestamp>_<sessionId>.jsonl.
function writeTranscript(input: { projectDirectory: string; fileName: string; mtimeMs: number }): string {
  const sessionsDirectory = createSessionsDirectory()
  writeTranscriptInto({ ...input, sessionsDirectory })
  return sessionsDirectory
}

// Senpi encodes a session cwd into one directory segment. A Windows path carries a drive colon and
// backslashes, neither legal inside a segment, so the fixture mirrors the production normalizer
// (storage/stale-work.ts: toLowerCase().replace(/[^a-z0-9]+/g, "-")) instead of splitting on "/".
function encodeSessionCwd(directory: string): string {
	return directory.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function writeTranscriptInto(input: {
  sessionsDirectory: string
  projectDirectory: string
  fileName: string
  mtimeMs: number
}): void {
  const projectSessionsDirectory = join(
    input.sessionsDirectory,
    `--${encodeSessionCwd(input.projectDirectory)}--`,
  )
  mkdirSync(projectSessionsDirectory, { recursive: true })
  const transcriptPath = join(projectSessionsDirectory, input.fileName)
  writeFileSync(transcriptPath, `${JSON.stringify({ type: "session", id: "01a09988-f0b5-7e7c-97b2-ea591aa4bdaf" })}\n`, "utf-8")
  const mtime = new Date(input.mtimeMs)
  utimesSync(transcriptPath, mtime, mtime)
}


test("#given a Windows-shaped session cwd #when it is encoded for a session directory #then the segment carries no drive colon or separator", () => {
	// A drive colon and a backslash are both illegal inside a Windows path segment, so a fixture that
	// splits on "/" alone produced mkdir ENOENT on Windows runners while passing on POSIX.
	const encoded = encodeSessionCwd("C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\boulder-stale-work-z5FTDO")
	expect(encoded).toBe("C-Users-RUNNER-1-AppData-Local-Temp-boulder-stale-work-z5FTDO")
	expect(/[:\\/]/.test(encoded)).toBe(false)
})

describe("reconcileStaleWorks", () => {
  test("#given an active work whose only session transcript is 41 hours old #when reconciling #then the work is paused and stamped", () => {
    // given
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const directory = createProject({ [STALE_WORK_ID]: createStaleWorkRecord() }, STALE_WORK_ID)
    const sessionsDirectory = writeTranscript({
      projectDirectory: directory,
      fileName: STALE_TRANSCRIPT_FILE,
      mtimeMs: nowMs - 41 * HOUR_MS,
    })

    // when
    const result = reconcileStaleWorks(directory, { sessionsDirectory, now: nowMs })

    // then
    expect(result.demoted.map((demotion) => demotion.work_id)).toEqual([STALE_WORK_ID])
    const work = readBoulderState(directory)?.works?.[STALE_WORK_ID]
    expect(work?.status).toBe("paused")
    expect(work?.stale_since).toBe(new Date(nowMs).toISOString())
    expect(work?.session_ids).toEqual([STALE_SESSION_ID])
  })

  test("#given a demoted work #when reading its record #then every other field survives the demotion", () => {
    // given
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const directory = createProject({ [STALE_WORK_ID]: createStaleWorkRecord() }, STALE_WORK_ID)
    const sessionsDirectory = writeTranscript({
      projectDirectory: directory,
      fileName: STALE_TRANSCRIPT_FILE,
      mtimeMs: nowMs - 41 * HOUR_MS,
    })

    // when
    const result = reconcileStaleWorks(directory, { sessionsDirectory, now: nowMs })

    // then
    expect(result.written).toBe(true)
    expect(result.demoted[0]?.last_activity_at).toBe(new Date(nowMs - 41 * HOUR_MS).toISOString())
    const work = readBoulderState(directory)?.works?.[STALE_WORK_ID] as Record<string, unknown> | undefined
    expect(work?.["active_plan"]).toBe(".omo/plans/omo-agent-toolkit-eval-sdk.md")
    expect(work?.["plan_name"]).toBe("omo-agent-toolkit-eval-sdk")
    expect(work?.["ulw_loop_session"]).toBe("01a09988-f0b5-7e7c-97b2-ea591aa4bdaf")
    expect(work?.["mode"]).toBe("--ship")
  })

  test("#given a demoted work #when listing resume options #then it is still resumable", () => {
    // given
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const directory = createProject({ [STALE_WORK_ID]: createStaleWorkRecord() }, STALE_WORK_ID)
    const sessionsDirectory = writeTranscript({
      projectDirectory: directory,
      fileName: STALE_TRANSCRIPT_FILE,
      mtimeMs: nowMs - 41 * HOUR_MS,
    })
    reconcileStaleWorks(directory, { sessionsDirectory, now: nowMs })

    // when
    const resumeOptions = getWorkResumeOptions(directory)

    // then
    expect(resumeOptions.map((option) => [option.work_id, option.status])).toEqual([[STALE_WORK_ID, "paused"]])
  })

  test("#given an active work whose session transcript is one hour old #when reconciling #then nothing is written", () => {
    // given
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const directory = createProject({ [STALE_WORK_ID]: createStaleWorkRecord() }, STALE_WORK_ID)
    const sessionsDirectory = writeTranscript({
      projectDirectory: directory,
      fileName: STALE_TRANSCRIPT_FILE,
      mtimeMs: nowMs - HOUR_MS,
    })
    const rawStateBefore = readRawState(directory)

    // when
    const result = reconcileStaleWorks(directory, { sessionsDirectory, now: nowMs })

    // then
    expect(result).toEqual({ demoted: [], written: false })
    expect(readRawState(directory)).toBe(rawStateBefore)
    expect(readBoulderState(directory)?.works?.[STALE_WORK_ID]?.status).toBe("active")
  })

  test("#given a completed work with no activity for days #when reconciling #then it is left untouched", () => {
    // given
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const directory = createProject(
      { [STALE_WORK_ID]: createStaleWorkRecord({ status: "completed", ended_at: "2026-09-13T08:00:00.000Z" }) },
      STALE_WORK_ID,
    )
    const sessionsDirectory = createSessionsDirectory()
    const rawStateBefore = readRawState(directory)

    // when
    const result = reconcileStaleWorks(directory, { sessionsDirectory, now: nowMs })

    // then
    expect(result).toEqual({ demoted: [], written: false })
    expect(readRawState(directory)).toBe(rawStateBefore)
    expect(readBoulderState(directory)?.works?.[STALE_WORK_ID]?.status).toBe("completed")
  })

  test("#given no transcript but a fresh updated_at #when reconciling #then the work stays active", () => {
    // given
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const directory = createProject(
      { [STALE_WORK_ID]: createStaleWorkRecord({ updated_at: new Date(nowMs - HOUR_MS).toISOString() }) },
      STALE_WORK_ID,
    )
    const sessionsDirectory = createSessionsDirectory()
    const rawStateBefore = readRawState(directory)

    // when
    const result = reconcileStaleWorks(directory, { sessionsDirectory, now: nowMs })

    // then
    expect(result).toEqual({ demoted: [], written: false })
    expect(readRawState(directory)).toBe(rawStateBefore)
    expect(readBoulderState(directory)?.works?.[STALE_WORK_ID]?.status).toBe("active")
  })

  test("#given no transcript and no timestamps #when reconciling #then the work is demoted with no last activity", () => {
    // given
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const directory = createProject({ [STALE_WORK_ID]: createStaleWorkRecord() }, STALE_WORK_ID)
    const sessionsDirectory = createSessionsDirectory()

    // when
    const result = reconcileStaleWorks(directory, { sessionsDirectory, now: nowMs })

    // then
    expect(result.demoted).toEqual([
      { work_id: STALE_WORK_ID, stale_since: new Date(nowMs).toISOString(), last_activity_at: null },
    ])
    expect(readBoulderState(directory)?.works?.[STALE_WORK_ID]?.status).toBe("paused")
  })

  test("#given a session id that resolves to no transcript #when reconciling #then it is demoted and no unrelated transcript matches it", () => {
    // given - `senpi:unknown` can never name a transcript, and a fresh unrelated one sits beside it
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const directory = createProject(
      { [STALE_WORK_ID]: createStaleWorkRecord({ session_ids: ["senpi:unknown"] }) },
      STALE_WORK_ID,
    )
    const sessionsDirectory = writeTranscript({
      projectDirectory: directory,
      fileName: STALE_TRANSCRIPT_FILE,
      mtimeMs: nowMs - 60 * 1000,
    })
    writeTranscriptInto({
      sessionsDirectory,
      projectDirectory: directory,
      fileName: "2026-09-13T06-51-23-701Z_not-unknown.jsonl",
      mtimeMs: nowMs - 60 * 1000,
    })

    // when
    const result = reconcileStaleWorks(directory, { sessionsDirectory, now: nowMs })

    // then
    expect(result.demoted).toEqual([
      { work_id: STALE_WORK_ID, stale_since: new Date(nowMs).toISOString(), last_activity_at: null },
    ])
    expect(readBoulderState(directory)?.works?.[STALE_WORK_ID]?.status).toBe("paused")
  })

  test("#given an active work quiet for 31 days #when reconciling #then it is demoted with its last activity recorded", () => {
    // given
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const lastActivityMs = nowMs - 31 * 24 * HOUR_MS
    const directory = createProject({ [STALE_WORK_ID]: createStaleWorkRecord() }, STALE_WORK_ID)
    const sessionsDirectory = writeTranscript({
      projectDirectory: directory,
      fileName: STALE_TRANSCRIPT_FILE,
      mtimeMs: lastActivityMs,
    })

    // when
    const result = reconcileStaleWorks(directory, { sessionsDirectory, now: nowMs })

    // then
    expect(result.demoted).toEqual([
      {
        work_id: STALE_WORK_ID,
        stale_since: new Date(nowMs).toISOString(),
        last_activity_at: new Date(lastActivityMs).toISOString(),
      },
    ])
    expect(readBoulderState(directory)?.works?.[STALE_WORK_ID]?.status).toBe("paused")
  })

  test("#given no boulder file #when reconciling #then nothing is written and nothing throws", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "boulder-stale-empty-"))

    // when
    const result = reconcileStaleWorks(directory, { sessionsDirectory: createSessionsDirectory() })

    // then
    expect(result).toEqual({ demoted: [], written: false })
    expect(existsSync(getBoulderFilePath(directory))).toBe(false)
  })

  test("#given an unreadable boulder file #when reconciling #then nothing is written and nothing throws", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "boulder-stale-broken-"))
    mkdirSync(join(directory, ".omo"), { recursive: true })
    writeFileSync(getBoulderFilePath(directory), "{not-json", "utf-8")

    // when
    const result = reconcileStaleWorks(directory, { sessionsDirectory: createSessionsDirectory() })

    // then
    expect(result).toEqual({ demoted: [], written: false })
    expect(readRawState(directory)).toBe("{not-json")
  })
})

describe("resuming a demoted work", () => {
  test("#given a demoted work #when it is selected as the active work #then it is active again with no stale stamp", () => {
    // given
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const directory = createProject({ [STALE_WORK_ID]: createStaleWorkRecord() }, STALE_WORK_ID)
    reconcileStaleWorks(directory, { sessionsDirectory: createSessionsDirectory(), now: nowMs })

    // when
    selectActiveWork(directory, STALE_WORK_ID)

    // then
    const work = readBoulderState(directory)?.works?.[STALE_WORK_ID]
    expect(work?.status).toBe("active")
    expect(work?.stale_since).toBeUndefined()
  })

  test("#given a demoted work #when a session is appended to it #then it is active again with no stale stamp", () => {
    // given
    const nowMs = Date.parse("2026-09-17T06:00:00.000Z")
    const directory = createProject({ [STALE_WORK_ID]: createStaleWorkRecord() }, STALE_WORK_ID)
    reconcileStaleWorks(directory, { sessionsDirectory: createSessionsDirectory(), now: nowMs })

    // when
    appendSessionIdForWork(directory, STALE_WORK_ID, "senpi:01a0ae2a-0000-7000-8000-000000000000", "appended")

    // then
    const work = readBoulderState(directory)?.works?.[STALE_WORK_ID]
    expect(work?.status).toBe("active")
    expect(work?.stale_since).toBeUndefined()
    expect(work?.session_ids).toEqual([STALE_SESSION_ID, "senpi:01a0ae2a-0000-7000-8000-000000000000"])
  })

  test("#given a work paused without a stale stamp #when it is selected #then its status is preserved", () => {
    // given
    const directory = createProject({ [STALE_WORK_ID]: createStaleWorkRecord({ status: "paused" }) }, STALE_WORK_ID)

    // when
    selectActiveWork(directory, STALE_WORK_ID)

    // then
    expect(readBoulderState(directory)?.works?.[STALE_WORK_ID]?.status).toBe("paused")
  })
})

describe("isWorkStale", () => {
  test("#given activity exactly at the threshold #when tested #then the work is stale", () => {
    expect(isWorkStale({ lastActivityMs: 1000, nowMs: 1000 + HOUR_MS, thresholdMs: HOUR_MS })).toBe(true)
  })

  test("#given activity one millisecond inside the threshold #when tested #then the work is not stale", () => {
    expect(isWorkStale({ lastActivityMs: 1001, nowMs: 1000 + HOUR_MS, thresholdMs: HOUR_MS })).toBe(false)
  })

  test("#given no activity evidence #when tested #then the work is stale", () => {
    expect(isWorkStale({ lastActivityMs: null, nowMs: 1000, thresholdMs: HOUR_MS })).toBe(true)
  })

  test("#given activity stamped in the future #when tested #then the work is not stale", () => {
    expect(isWorkStale({ lastActivityMs: 2000 + HOUR_MS, nowMs: 2000, thresholdMs: HOUR_MS })).toBe(false)
  })
})

describe("resolveStaleWorkThresholdMs", () => {
  test("#given no env knob #when resolving #then the six hour default is used", () => {
    expect(resolveStaleWorkThresholdMs({})).toBe(DEFAULT_STALE_WORK_THRESHOLD_MS)
    expect(DEFAULT_STALE_WORK_THRESHOLD_MS).toBe(6 * HOUR_MS)
  })

  test("#given the env knob #when resolving #then it overrides the default", () => {
    expect(resolveStaleWorkThresholdMs({ [STALE_WORK_THRESHOLD_ENV_KEY]: " 900000 " })).toBe(900000)
  })

  test("#given a non-positive or unparsable env knob #when resolving #then the default is used", () => {
    expect(resolveStaleWorkThresholdMs({ [STALE_WORK_THRESHOLD_ENV_KEY]: "0" })).toBe(DEFAULT_STALE_WORK_THRESHOLD_MS)
    expect(resolveStaleWorkThresholdMs({ [STALE_WORK_THRESHOLD_ENV_KEY]: "soon" })).toBe(DEFAULT_STALE_WORK_THRESHOLD_MS)
  })
})
