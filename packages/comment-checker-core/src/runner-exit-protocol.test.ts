import { describe, expect, test } from "bun:test"

import { runCommentChecker } from "./runner"
import type { SpawnProcess } from "./types"

function fakeProcess(exitCode: number, stderr: string): SpawnProcess {
  return {
    stdin: { write() {}, end() {} },
    stdout: new Response("").body as ReadableStream<Uint8Array>,
    stderr: new Response(stderr).body as ReadableStream<Uint8Array>,
    exited: Promise.resolve(exitCode),
    kill() {},
  }
}

function run(exitCode: number, stderr = "") {
  return runCommentChecker(
    { binaryPath: "/fake/comment-checker", hookInput: { tool_name: "Write", tool_input: {} } as never },
    { existsSync: () => true, spawn: () => fakeProcess(exitCode, stderr) },
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
})
