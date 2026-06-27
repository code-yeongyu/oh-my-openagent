import { describe, expect, test, mock, spyOn } from "bun:test"
import {
  interpolateInstruction,
  resolveCommandTimeoutMs,
  shellEscapeArg,
  terminateCommandProcess,
  wakeGateway,
  wakeCommandGateway,
} from "../dispatcher"

const commandGatewayTestTimeoutMs = process.platform === "win32" ? 10_000 : 1_000

describe("OpenClaw Dispatcher", () => {
  function withPlatform<T>(platform: NodeJS.Platform, callback: () => T): T {
    const originalPlatform = process.platform
    Object.defineProperty(process, "platform", { value: platform })
    try {
      return callback()
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform })
    }
  }

  test("interpolateInstruction replaces variables", () => {
    const template = "Hello {{name}}, welcome to {{place}}!"
    const variables = { name: "World", place: "Bun" }
    expect(interpolateInstruction(template, variables)).toBe(
      "Hello World, welcome to Bun!",
    )
  })

  test("interpolateInstruction handles missing variables", () => {
    const template = "Hello {{name}}!"
    const variables = {}
    expect(interpolateInstruction(template, variables)).toBe("Hello !")
  })

  test("shellEscapeArg escapes single quotes", () => {
    expect(shellEscapeArg("foo'bar")).toBe("'foo'\\''bar'")
    expect(shellEscapeArg("simple")).toBe("'simple'")
  })

  test("wakeGateway sends POST request", async () => {
    const fetchSpy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    try {
      const result = await wakeGateway(
        "test",
        { url: "https://example.com", method: "POST", timeout: 1000, type: "http" },
        { foo: "bar" },
      )

      expect(result.success).toBe(true)
      expect(fetchSpy).toHaveBeenCalled()
      const call = fetchSpy.mock.calls.find(c => c[0] === "https://example.com")
      expect(call).toBeDefined()
      if (!call) {
        throw new Error("Expected fetch call for https://example.com")
      }
      expect(call[0]).toBe("https://example.com")
      expect(call[1]?.method).toBe("POST")
      expect(call[1]?.body).toBe('{"foo":"bar"}')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("wakeGateway returns correlation metadata from JSON response", async () => {
    const fetchSpy = spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            messageId: "msg-123",
            platform: "discord",
            channelId: "chan-1",
            threadId: "thread-9",
          },
        }),
        { status: 200 },
      ),
    )

    try {
      const result = await wakeGateway(
        "test",
        { url: "https://example.com", method: "POST", timeout: 1000, type: "http" },
        { foo: "bar" },
      )

      expect(result).toMatchObject({
        success: true,
        messageId: "msg-123",
        platform: "discord",
        channelId: "chan-1",
        threadId: "thread-9",
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("#given gateway metadata JSON parsing fails with a non-Error #when wakeGateway parses metadata #then it preserves the successful wake fallback", async () => {
    // given
    const fetchSpy = spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    const parseSpy = spyOn(JSON, "parse").mockImplementation(() => {
      throw { kind: "json-parse-thrown-value" } as const
    })

    try {
      // when
      const result = await wakeGateway(
        "test",
        { url: "https://example.com", method: "POST", timeout: 1000, type: "http" },
        { foo: "bar" },
      )

      // then
      expect(result).toMatchObject({
        gateway: "test",
        success: true,
        statusCode: 200,
      })
    } finally {
      fetchSpy.mockRestore()
      parseSpy.mockRestore()
    }
  })

  test("wakeGateway prefers nested message metadata over wrapper ids", async () => {
    const fetchSpy = spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "job-42",
          data: {
            messageId: "msg-123",
            platform: "discord",
            channelId: "chan-1",
            threadId: "thread-9",
          },
        }),
        { status: 200 },
      ),
    )

    try {
      const result = await wakeGateway(
        "test",
        { url: "https://example.com", method: "POST", timeout: 1000, type: "http" },
        { foo: "bar" },
      )

      expect(result).toMatchObject({
        success: true,
        messageId: "msg-123",
        platform: "discord",
        channelId: "chan-1",
        threadId: "thread-9",
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("wakeGateway fails on invalid URL", async () => {
    const result = await wakeGateway("test", { url: "http://example.com", method: "POST", timeout: 1000, type: "http" }, {})
    expect(result.success).toBe(false)
    expect(result.error).toContain("Invalid URL")
  })

  test("resolveCommandTimeoutMs reads OMO env fallback", () => {
    const original = process.env.OMO_OPENCLAW_COMMAND_TIMEOUT_MS
    process.env.OMO_OPENCLAW_COMMAND_TIMEOUT_MS = "4321"

    try {
      // Call without explicit envTimeoutRaw so the function reads from process.env itself
      expect(resolveCommandTimeoutMs(undefined)).toBe(4321)
    } finally {
      if (original === undefined) delete process.env.OMO_OPENCLAW_COMMAND_TIMEOUT_MS
      else process.env.OMO_OPENCLAW_COMMAND_TIMEOUT_MS = original
    }
  })

  test("resolveCommandTimeoutMs clamps explicit and env timeout values", () => {
    expect(resolveCommandTimeoutMs(99)).toBe(100)
    expect(resolveCommandTimeoutMs(300_001)).toBe(300_000)
    expect(resolveCommandTimeoutMs(1500.9)).toBe(1500)
    expect(resolveCommandTimeoutMs(undefined, "not-a-number")).toBe(5_000)
    expect(resolveCommandTimeoutMs(undefined, "50")).toBe(100)
    expect(resolveCommandTimeoutMs(undefined, "400000")).toBe(300_000)
  })

  test("terminateCommandProcess kills process group on unix when pid exists", () => {
    const killSpy = spyOn(process, "kill").mockImplementation(() => true)
    const proc = {
      pid: 4321,
      kill: mock(() => {}),
    }

    try {
      withPlatform("linux", () => terminateCommandProcess(proc, "SIGKILL"))

      expect(killSpy).toHaveBeenCalledWith(-4321, "SIGKILL")
      expect(proc.kill).not.toHaveBeenCalled()
    } finally {
      killSpy.mockRestore()
    }
  })

  test("terminateCommandProcess falls back to direct kill when process group kill fails", () => {
    const killSpy = spyOn(process, "kill").mockImplementation(() => {
      throw new Error("group kill failed")
    })
    const proc = {
      pid: 9876,
      kill: mock(() => {}),
    }

    try {
      withPlatform("linux", () => terminateCommandProcess(proc, "SIGKILL"))

      expect(killSpy).toHaveBeenCalledWith(-9876, "SIGKILL")
      expect(proc.kill).toHaveBeenCalledWith("SIGKILL")
    } finally {
      killSpy.mockRestore()
    }
  })

  test("terminateCommandProcess suppresses direct kill failures", () => {
    const proc = {
      kill: mock(() => {
        throw new Error("process already exited")
      }),
    }

    expect(() => terminateCommandProcess(proc, "SIGKILL")).not.toThrow()
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL")
  })

  test("wakeCommandGateway returns correlation metadata from stdout JSON", async () => {
    const result = await wakeCommandGateway(
      "command",
      {
        type: "command",
        method: "POST",
        command: "printf '%s' '{\"messageId\":\"55\",\"platform\":\"telegram\",\"threadId\":\"thr\"}'",
        timeout: commandGatewayTestTimeoutMs,
      },
      {},
    )

    expect(result).toMatchObject({
      success: true,
      messageId: "55",
      platform: "telegram",
      threadId: "thr",
    })
  })

  test("wakeCommandGateway returns correlation metadata from OpenClaw CLI stdout", async () => {
    const result = await wakeCommandGateway(
      "command",
      {
        type: "command",
        method: "POST",
        command: "printf '%s' '✅ Sent via Discord. Message ID: 55'",
        timeout: commandGatewayTestTimeoutMs,
      },
      {},
    )

    expect(result).toMatchObject({
      success: true,
      messageId: "55",
      platform: "discord",
    })
  })
})
