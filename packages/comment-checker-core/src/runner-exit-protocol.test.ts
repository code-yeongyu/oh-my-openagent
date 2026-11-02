import { describe, expect, test } from "bun:test"

import { runCommentChecker } from "./runner"
import type { SpawnProcess } from "./types"

function fakeProcess(exitCode: number, stderr: string, delivered = true): SpawnProcess {
  return {
    stdin: { send: () => (delivered ? Promise.resolve() : Promise.reject(new Error("write EPIPE"))) },
    stdout: new Response("").body as ReadableStream<Uint8Array>,
    stderr: new Response(stderr).body as ReadableStream<Uint8Array>,
    exited: Promise.resolve(exitCode),
    kill() {},
  }
}

function run(exitCode: number, stderr = "", delivered = true) {
  return runCommentChecker(
    { binaryPath: "/fake/comment-checker", hookInput: { tool_name: "Write", tool_input: {} } as never },
    { existsSync: () => true, spawn: () => fakeProcess(exitCode, stderr, delivered) },
  )
}

describe("comment-checker exit protocol (#8850)", () => {
  test("#given the checker exits 0 #when run #then it is a clean result without a failure", async () => {
    // when
    const result = await run(0)

    // then
    expect(result).toEqual({ hasComments: false, message: "" })
  })

  test("#given the checker exits 2 #when run #then its stderr is the comment feedback", async () => {
    // when
    const result = await run(2, "found a comment\r\n")

    // then
    expect(result).toEqual({ hasComments: true, message: "found a comment\n" })
  })

  test.each([
    ["STATUS_DLL_NOT_FOUND on Windows", 3221225781, ""],
    ["a generic failure", 1, "exec format error\n"],
  ])("#given the checker exits outside the protocol (%s) #when run #then no comments are reported and the failure is exposed", async (_name, exitCode, stderr) => {
    // when
    const result = await run(exitCode, stderr)

    // then
    expect(result.hasComments).toBe(false)
    expect(result.message).toBe("")
    expect(result.failure).toEqual({ exitCode, stderr: stderr.trim() })
  })

  test("#given a checker that cannot start exits before reading its input #when run #then the failure is still exposed", async () => {
    // when
    const result = await run(3221225781, "", false)

    // then
    expect(result).toEqual({ hasComments: false, message: "", failure: { exitCode: 3221225781, stderr: "" } })
  })

  test("#given the spawn fails after it returned (EACCES) and the output streams abort #when run #then the start failure is exposed", async () => {
    // given
    const aborted = () => new ReadableStream<Uint8Array>({ start: (controller) => controller.error(new Error("The operation was aborted")) })
    const notStarted: SpawnProcess = {
      stdin: { send: () => Promise.reject(new Error("write EPIPE")) },
      stdout: aborted(),
      stderr: aborted(),
      exited: Promise.reject(new Error("spawn /fake/comment-checker EACCES")),
      kill() {},
    }

    // when
    const result = await runCommentChecker(
      { binaryPath: "/fake/comment-checker", hookInput: { tool_name: "Write", tool_input: {} } as never },
      { existsSync: () => true, spawn: () => notStarted },
    )

    // then
    expect(result).toEqual({ hasComments: false, message: "", failure: { exitCode: null, stderr: "spawn /fake/comment-checker EACCES" } })
  })

  test("#given the checker exits 2 but its stderr cannot be read #when run #then no comments are reported", async () => {
    // given
    const unreadable: SpawnProcess = {
      ...fakeProcess(2, ""),
      stderr: new ReadableStream<Uint8Array>({ start: (controller) => controller.error(new Error("stream reset")) }),
    }

    // when
    const result = await runCommentChecker(
      { binaryPath: "/fake/comment-checker", hookInput: { tool_name: "Write", tool_input: {} } as never },
      { existsSync: () => true, spawn: () => unreadable },
    )

    // then
    expect(result).toEqual({ hasComments: false, message: "" })
  })

  test("#given a checker that exits 0 before reading its input #when run #then it is a clean result without a failure", async () => {
    // when
    const result = await run(0, "", false)

    // then
    expect(result).toEqual({ hasComments: false, message: "" })
  })
})
