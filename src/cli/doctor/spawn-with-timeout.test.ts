import { describe, it, expect } from "bun:test"
import { spawnWithTimeout } from "./spawn-with-timeout"

describe("spawnWithTimeout", () => {
  describe("#given a command that completes quickly", () => {
    it("returns stdout and exit code", async () => {
      // when
      const result = await spawnWithTimeout(["echo", "hello"], { stdout: "pipe", stderr: "pipe" })

      // then
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe("hello")
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
    })
  })
})
