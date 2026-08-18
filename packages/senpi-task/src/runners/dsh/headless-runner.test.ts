import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { runDshHeadless } from "./headless-runner"

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const fakeHeadless = join(fixtureDir, "__fixtures__", "fake-dsh-headless.mjs")

function makeInput(overrides: Partial<Parameters<typeof runDshHeadless>[0]> = {}) {
  return {
    command: process.execPath,
    args: [fakeHeadless],
    cwd: "/tmp",
    prompt: "build the thing",
    timeoutMs: 10000,
    abort: new AbortController().signal,
    ...overrides,
  }
}

describe("runDshHeadless", () => {
  test("#given a cooperative headless profile #when the task completes #then returns the final output with exit code 0", async () => {
    // given / when
    const result = await runDshHeadless(makeInput({ args: [fakeHeadless, "ok"] }))

    // then
    expect(result.output).toContain("RESULT: build the thing")
    expect(result.exitCode).toBe(0)
  })

  test("#given a headless profile that errors #when the child exits non-zero #then rejects with the stderr message", async () => {
    // given / when / then
    await expect(
      runDshHeadless(makeInput({ args: [fakeHeadless, "fail"] })),
    ).rejects.toThrow("model exploded")
  })

  test("#given a hanging headless profile #when the timeout expires #then rejects", async () => {
    // given / when / then
    await expect(
      runDshHeadless(makeInput({ args: [fakeHeadless, "hang"], timeoutMs: 500 })),
    ).rejects.toThrow("exceeded 500ms")
  })

  test("#given an already-aborted signal #when the run starts #then rejects immediately", async () => {
    // given
    const controller = new AbortController()
    controller.abort()

    // when / then
    await expect(
      runDshHeadless(makeInput({ args: [fakeHeadless, "ok"], abort: controller.signal })),
    ).rejects.toThrow("aborted")
  })
})