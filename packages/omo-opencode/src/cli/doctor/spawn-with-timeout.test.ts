/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { SpawnedProcess } from "../../shared/spawn-with-windows-hide"
import * as spawnWithWindowsHideModule from "../../shared/spawn-with-windows-hide"
import { spawnWithTimeout } from "./framework/spawn-with-timeout"

describe("spawnWithTimeout", () => {
  describe("#given a command that completes quickly", () => {
    it("returns stdout and exit code", async () => {
      // when
      const result = await spawnWithTimeout(["echo", "hello"], { stdout: "pipe", stderr: "pipe" })

      // then
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe("hello")
      expect(result.stderr).toBe("")
    })
  })

  describe("#given a command that writes to stderr", () => {
    it("captures stderr output", async () => {
      // when
      const result = await spawnWithTimeout(
        [process.execPath, "-e", "console.error('err')"],
        { stdout: "pipe", stderr: "pipe" }
      )

      // then
      expect(result.timedOut).toBe(false)
      expect(result.stderr.trim()).toBe("err")
    })
  })

  describe("#given a command that fails", () => {
    it("returns non-zero exit code without timing out", async () => {
      // when
      const result = await spawnWithTimeout(["false"], { stdout: "pipe", stderr: "pipe" })

      // then
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).not.toBe(0)
    })
  })

  describe("#given a command that exceeds timeout", () => {
    it("returns timedOut true and kills the process", async () => {
      // when
      const result = await spawnWithTimeout(
        [process.execPath, "-e", "setInterval(() => {}, 1000)"],
        { stdout: "pipe", stderr: "pipe" },
        200
      )

      // then
      expect(result.timedOut).toBe(true)
      expect(result.stdout).toBe("")
      expect(result.stderr).toBe("")
    })
  })

  describe("#given a nonexistent command", () => {
    it("handles gracefully without hanging", async () => {
      // when
      const result = await spawnWithTimeout(
        ["nonexistent-binary-that-does-not-exist-12345"],
        { stdout: "pipe", stderr: "pipe" },
        2000
      )

      // then
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).toBe(1)
    })

    it("does not consume process streams more than once", async () => {
      // given
      const unreadableCommand = process.platform === "win32" ? ["cmd", "/c", "exit", "9009"] : ["false"]

      // when
      const result = await spawnWithTimeout(unreadableCommand, { stdout: "pipe", stderr: "pipe" }, 2000)

      // then
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).not.toBe(0)
      expect(typeof result.stdout).toBe("string")
      expect(typeof result.stderr).toBe("string")
    })
  })

  describe("#given spawn throws a non-Error value", () => {
    afterEach(() => {
      mock.restore()
    })

    it("rethrows the unknown value", async () => {
      // given
      const unknownFailure = { reason: "spawn failed" } as const
      spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation(() => {
        throw unknownFailure
      })

      // when
      const result = await spawnWithTimeout(["test-command"], { stdout: "pipe", stderr: "pipe" }).then(
        () => "resolved",
        (error: unknown) => error,
      )

      // then
      expect(result).toBe(unknownFailure)
    })
  })

  describe("#given a spawned process exposes an already-used pipe", () => {
    afterEach(() => {
      mock.restore()
    })

    it("treats the pipe as empty output", async () => {
      // given
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ignored"))
          controller.close()
        },
      })
      await new Response(stream).text()
      const spawnedProcess = {
        exitCode: 1,
        exited: Promise.resolve(1),
        stdout: stream,
        stderr: undefined,
        kill: () => {},
      } satisfies SpawnedProcess
      spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation(() => spawnedProcess)

      // when
      const result = await spawnWithTimeout(["test-command"], { stdout: "pipe", stderr: "pipe" })

      // then
      expect(result).toEqual({ stdout: "", stderr: "", exitCode: 1, timedOut: false })
    })
  })
})
