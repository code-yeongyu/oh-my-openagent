import { describe, expect, it } from "bun:test"

import { runCommentChecker } from "./runner"
import { sendAndCloseStdin } from "./stdin-delivery"
import type { SpawnProcess, SpawnSignal } from "./types"

const HOOK_INPUT = {
  session_id: "session-1",
  tool_name: "write",
  transcript_path: "",
  cwd: ".",
  hook_event_name: "PostToolUse",
  tool_input: { file_path: "src/a.ts", content: "x" },
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start: (controller) => controller.close() })
}

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

function brokenPipe(): Error {
  return Object.assign(new Error("write EPIPE"), { code: "EPIPE" })
}

describe("runCommentChecker stdin delivery (#6396)", () => {
  it("#given stdin delivery fails #when the checker still exits 2 #then the child is killed and the result is empty", async () => {
    // given
    const signals: SpawnSignal[] = []
    let exit: (code: number) => void = () => {}
    const child: SpawnProcess = {
      stdin: { send: () => Promise.reject(brokenPipe()) },
      stdout: emptyStream(),
      stderr: textStream("partial input looked like a comment"),
      exited: new Promise<number>((resolve) => {
        exit = resolve
      }),
      kill(signal) {
        signals.push(signal)
        exit(2)
      },
    }

    // when
    const result = await runCommentChecker(
      { binaryPath: "/checker", hookInput: HOOK_INPUT },
      { existsSync: () => true, spawn: () => child },
    )

    // then
    expect({ result, signals }).toEqual({ result: { hasComments: false, message: "" }, signals: ["SIGKILL"] })
  })

  it("#given spawn throws synchronously #when the checker runs #then no comments are reported and the start failure is exposed", async () => {
    // when
    const result = await runCommentChecker(
      { binaryPath: "/checker", hookInput: HOOK_INPUT },
      {
        existsSync: () => true,
        spawn: () => {
          throw new Error("spawn EINVAL")
        },
      },
    )

    // then
    expect(result).toEqual({ hasComments: false, message: "", failure: { exitCode: null, stderr: "spawn EINVAL" } })
  })

  it("#given a file-sink stdin whose write rejects #when input is sent #then the send rejects with that error", async () => {
    // given
    const failure = brokenPipe()
    const sink = { write: () => Promise.reject(failure), end: () => 0 }

    // when
    const outcome = await sendAndCloseStdin(sink, "input").then(
      () => "resolved",
      (error: unknown) => error,
    )

    // then
    expect(outcome).toBe(failure)
  })
})
