import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { runDshAcpAgent } from "./acp-client"

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const fakeServer = join(fixtureDir, "__fixtures__", "fake-dsh-acp-server.mjs")

function makeInput(overrides: Partial<Parameters<typeof runDshAcpAgent>[0]> = {}) {
  return {
    command: process.execPath,
    args: [fakeServer],
    cwd: "/tmp",
    prompt: "build the thing",
    permission: "reject" as const,
    timeoutMs: 10000,
    abort: new AbortController().signal,
    ...overrides,
  }
}

describe("runDshAcpAgent", () => {
  test("#given a cooperative child #when the prompt settles #then returns the committed text and stop reason", async () => {
    // given / when
    const result = await runDshAcpAgent(makeInput({ args: [fakeServer, "happy"] }))

    // then
    expect(result.output).toBe("Task done. All green.")
    expect(result.stopReason).toBe("end_turn")
  })

  test("#given a child that requests permission #when policy is reject #then the request is rejected and the refusal propagates", async () => {
    // given / when
    const result = await runDshAcpAgent(makeInput({ args: [fakeServer, "permission"], permission: "reject" }))

    // then
    expect(result.stopReason).toBe("refusal")
  })

  test("#given a child that requests permission #when policy is allow_once #then the first allow option is granted", async () => {
    // given / when
    const result = await runDshAcpAgent(makeInput({ args: [fakeServer, "permission"], permission: "allow_once" }))

    // then
    expect(result.stopReason).toBe("end_turn")
  })

  test("#given a child that errors #when the prompt response carries an rpc error #then rejects with the message", async () => {
    // given / when / then
    await expect(
      runDshAcpAgent(makeInput({ args: [fakeServer, "error"] })),
    ).rejects.toThrow("model exploded")
  })

  test("#given a child that never settles #when the timeout expires #then rejects and kills the child", async () => {
    // given / when / then
    await expect(
      runDshAcpAgent(makeInput({ args: [fakeServer, "hang"], timeoutMs: 500 })),
    ).rejects.toThrow("exceeded 500ms")
  })

  test("#given an already-aborted signal #when the run starts #then rejects immediately", async () => {
    // given
    const controller = new AbortController()
    controller.abort()

    // when / then
    await expect(
      runDshAcpAgent(makeInput({ args: [fakeServer, "happy"], abort: controller.signal })),
    ).rejects.toThrow("aborted")
  })
})