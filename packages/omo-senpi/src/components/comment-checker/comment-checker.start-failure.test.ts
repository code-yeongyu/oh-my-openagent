import { describe, expect, it } from "bun:test"
import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { CheckResult } from "@oh-my-opencode/comment-checker-core"

import {
  createContext,
  createRecordingLogger,
  createTempCwd,
  createToolResultEvent,
  registerWithFakeRunner,
} from "./comment-checker.test-support"
import { COMMENT_CHECKER_COULD_NOT_RUN } from "./failure-notice"
import { defaultRunCommentChecker } from "./runner"

type Notice = { message: string; level: string }

function contextWithUi(cwd: string): { context: Record<string, unknown>; notices: Notice[] } {
  const notices: Notice[] = []
  return {
    context: { ...createContext(cwd), ui: { notify: (message: string, level: string) => notices.push({ message, level }) } },
    notices,
  }
}

async function twoEdits(result: CheckResult) {
  const cwd = createTempCwd()
  const logger = createRecordingLogger()
  const { pi, calls } = await registerWithFakeRunner({ logger, result })
  const { context, notices } = contextWithUi(cwd)
  const first = await pi.dispatch("tool_result", createToolResultEvent(), context)
  const second = await pi.dispatch("tool_result", createToolResultEvent({ toolCallId: "tool-2", input: { path: "src/other.ts", edits: [] } }), context)
  return { calls, logger, notices, first, second }
}

describe("omo-senpi comment-checker that cannot start (#8850)", () => {
  it("#given a checker exiting outside its 0/2 protocol #when two edits finish #then it is reported once, in the session and the log, and not run again", async () => {
    // when
    const { calls, logger, notices, first, second } = await twoEdits({ hasComments: false, message: "", failure: { exitCode: 3221225781, stderr: "" } })

    // then
    expect(calls).toHaveLength(1)
    expect(first).toEqual([undefined])
    expect(second).toEqual([undefined])
    expect(logger.entries).toEqual([
      { level: "warn", message: COMMENT_CHECKER_COULD_NOT_RUN, details: { binaryPath: "/tmp/fake-comment-checker", exitCode: 3221225781, stderr: "" } },
    ])
    expect(notices.map((notice) => notice.level)).toEqual(["warning"])
    expect(notices[0]?.message).toContain("3221225781")
    expect(notices[0]?.message).toContain("/tmp/fake-comment-checker")
  })

  it("#given a checker that never started #when two edits finish #then it is reported once and not run again", async () => {
    // when
    const { calls, logger, notices } = await twoEdits({ hasComments: false, message: "", failure: { exitCode: null, stderr: "spawn /tmp/fake-comment-checker EACCES" } })

    // then
    expect(calls).toHaveLength(1)
    expect(logger.entries.map((entry) => entry.details)).toEqual([
      { binaryPath: "/tmp/fake-comment-checker", exitCode: null, stderr: "spawn /tmp/fake-comment-checker EACCES" },
    ])
    expect(notices.map((notice) => notice.level)).toEqual(["warning"])
    expect(notices[0]?.message).toContain("EACCES")
  })

  it("#given a checker that follows its protocol #when two edits finish #then it keeps running without warnings", async () => {
    // when
    const { calls, logger, notices } = await twoEdits({ hasComments: false, message: "" })

    // then
    expect(calls).toHaveLength(2)
    expect(logger.entries).toEqual([])
    expect(notices).toEqual([])
  })
})

describe.skipIf(process.platform === "win32")("omo-senpi comment-checker runner with a checker the OS refuses to start (#8850)", () => {
  it("#given a checker file without execute permission #when the real runner spawns it #then the start failure is exposed", async () => {
    // given
    const binaryPath = join(createTempCwd(), "comment-checker")
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n")
    chmodSync(binaryPath, 0o644)

    // when
    const result = await defaultRunCommentChecker({
      binaryPath,
      hookInput: { session_id: "s", tool_name: "write", transcript_path: "", cwd: ".", hook_event_name: "PostToolUse", tool_input: { file_path: "src/a.ts", content: "x" } },
    })

    // then
    expect(result.hasComments).toBe(false)
    expect(result.failure?.exitCode).toBeNull()
    expect(result.failure?.stderr).toContain("EACCES")
  })
})
