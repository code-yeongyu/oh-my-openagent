import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test"
import { executeOnCompleteHook } from "./on-complete-hook"

describe("executeOnCompleteHook", () => {
  function createProc(exitCode: number) {
    return {
      exited: Promise.resolve(exitCode),
      exitCode,
    } as unknown as ReturnType<typeof Bun.spawn>
  }

  let consoleErrorSpy: ReturnType<typeof spyOn<typeof console, "error">>

  beforeEach(() => {
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it("executes command with correct env vars", async () => {
    // given
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(createProc(0))

    try {
      // when
      await executeOnCompleteHook({
        command: "echo test",
        sessionId: "session-123",
        exitCode: 0,
        durationMs: 5000,
        messageCount: 10,
      })

      // then
      expect(spawnSpy).toHaveBeenCalledTimes(1)
      const [args, options] = spawnSpy.mock.calls[0] as Parameters<typeof Bun.spawn>

      expect(args).toEqual(["sh", "-c", "echo test"])
      expect(options?.env?.SESSION_ID).toBe("session-123")
      expect(options?.env?.EXIT_CODE).toBe("0")
      expect(options?.env?.DURATION_MS).toBe("5000")
      expect(options?.env?.MESSAGE_COUNT).toBe("10")
      expect(options?.stdout).toBe("inherit")
      expect(options?.stderr).toBe("inherit")
    } finally {
      spawnSpy.mockRestore()
    }
  })

  it("env var values are strings", async () => {
    // given
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(createProc(0))

    try {
      // when
      await executeOnCompleteHook({
        command: "echo test",
        sessionId: "session-123",
        exitCode: 1,
        durationMs: 12345,
        messageCount: 42,
      })

      // then
      const [_, options] = spawnSpy.mock.calls[0] as Parameters<typeof Bun.spawn>

      expect(options?.env?.EXIT_CODE).toBe("1")
      expect(options?.env?.EXIT_CODE).toBeTypeOf("string")
      expect(options?.env?.DURATION_MS).toBe("12345")
      expect(options?.env?.DURATION_MS).toBeTypeOf("string")
      expect(options?.env?.MESSAGE_COUNT).toBe("42")
      expect(options?.env?.MESSAGE_COUNT).toBeTypeOf("string")
    } finally {
      spawnSpy.mockRestore()
    }
  })

  it("empty command string is no-op", async () => {
    // given
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(createProc(0))

    try {
      // when
      await executeOnCompleteHook({
        command: "",
        sessionId: "session-123",
        exitCode: 0,
        durationMs: 5000,
        messageCount: 10,
      })

      // then
      expect(spawnSpy).not.toHaveBeenCalled()
    } finally {
      spawnSpy.mockRestore()
    }
  })

  it("whitespace-only command is no-op", async () => {
    // given
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(createProc(0))

    try {
      // when
      await executeOnCompleteHook({
        command: "   ",
        sessionId: "session-123",
        exitCode: 0,
        durationMs: 5000,
        messageCount: 10,
      })

      // then
      expect(spawnSpy).not.toHaveBeenCalled()
    } finally {
      spawnSpy.mockRestore()
    }
  })

  it("command failure logs warning but does not throw", async () => {
    // given
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(createProc(1))

    try {
      // when
      await expect(
        executeOnCompleteHook({
          command: "false",
          sessionId: "session-123",
          exitCode: 0,
          durationMs: 5000,
          messageCount: 10,
        })
      ).resolves.toBeUndefined()

      // then
      expect(consoleErrorSpy).toHaveBeenCalled()
      const warningCall = consoleErrorSpy.mock.calls.find(
        (call) => typeof call[0] === "string" && call[0].includes("Warning: on-complete hook exited with code 1")
      )
      expect(warningCall).toBeDefined()
    } finally {
      spawnSpy.mockRestore()
    }
  })

  it("spawn error logs warning but does not throw", async () => {
    // given
    const spawnError = new Error("Command not found")
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      throw spawnError
    })

    try {
      // when
      await expect(
        executeOnCompleteHook({
          command: "nonexistent-command",
          sessionId: "session-123",
          exitCode: 0,
          durationMs: 5000,
          messageCount: 10,
        })
      ).resolves.toBeUndefined()

      // then
      expect(consoleErrorSpy).toHaveBeenCalled()
      const errorCalls = consoleErrorSpy.mock.calls.filter((call) => {
        const firstArg = call[0]
        return typeof firstArg === "string" && (firstArg.includes("Warning") || firstArg.toLowerCase().includes("error"))
      })
      expect(errorCalls.length).toBeGreaterThan(0)
    } finally {
      spawnSpy.mockRestore()
    }
  })
})
