import { describe, it, expect, spyOn } from "bun:test"
import { spawnWithTimeout } from "./spawn-with-timeout"
import * as logger from "../../shared/logger"
import * as spawnHelpers from "../../shared/spawn-with-windows-hide"

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
        ["bash", "-c", "echo err >&2"],
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
        ["bash", "-c", "while true; do :; done"],
        { stdout: "pipe", stderr: "pipe" },
        200
      )

      // then
      expect(result.timedOut).toBe(true)
      expect(result.stdout).toBe("")
      expect(result.stderr).toBe("")
    })
  })

  describe("#given process start throws", () => {
    it("returns stderr and logs the failure", async () => {
      // given
      const logSpy = spyOn(logger, "log").mockImplementation(() => {})
      const spawnSpy = spyOn(spawnHelpers, "spawnWithWindowsHide").mockImplementation(() => {
        throw new Error("spawn failed")
      })

      try {
        // when
        const result = await spawnWithTimeout(["not-started"], { stdout: "pipe", stderr: "pipe" }, 2000)

        // then
        expect(result).toEqual({
          stdout: "",
          stderr: "spawn failed",
          exitCode: 1,
          timedOut: false,
        })
        expect(logSpy).toHaveBeenCalledWith("doctor spawn failed before process start", {
          command: ["not-started"],
          error: "spawn failed",
        })
      } finally {
        spawnSpy.mockRestore()
        logSpy.mockRestore()
      }
    })
  })
})
