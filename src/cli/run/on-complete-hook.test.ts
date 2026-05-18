import { describe, it, expect, spyOn, beforeEach, afterEach, mock } from "bun:test"
import * as spawnWithWindowsHideModule from "../../shared/spawn-with-windows-hide"
import * as loggerModule from "../../shared/logger"

type OnCompleteHookModule = typeof import("./on-complete-hook")

describe("executeOnCompleteHook", () => {
  let originalPlatform: NodeJS.Platform
  let originalEnv: Record<string, string | undefined>

  function createStream(text: string): ReadableStream<Uint8Array> | undefined {
    if (text.length === 0) {
      return undefined
    }

    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text))
        controller.close()
      },
    })
  }

  function createProc(exitCode: number, output?: { stdout?: string; stderr?: string }) {
    return {
      exited: Promise.resolve(exitCode),
      exitCode,
      stdout: createStream(output?.stdout ?? ""),
      stderr: createStream(output?.stderr ?? ""),
      kill: () => {},
    } satisfies ReturnType<typeof spawnWithWindowsHideModule.spawnWithWindowsHide>
  }

  let logCalls: Array<Parameters<typeof loggerModule.log>>

  async function importFreshExecuteOnCompleteHook(): Promise<
    OnCompleteHookModule["executeOnCompleteHook"]
  > {
    const onCompleteHookModule = await import(`./on-complete-hook?test=${Date.now()}-${Math.random()}`)
    return onCompleteHookModule.executeOnCompleteHook
  }

  beforeEach(() => {
    mock.restore()
    originalPlatform = process.platform
    originalEnv = {
      SHELL: process.env.SHELL,
      PSModulePath: process.env.PSModulePath,
      ComSpec: process.env.ComSpec,
    }
    logCalls = []
    spyOn(loggerModule, "log").mockImplementation((message: string, data?: unknown) => {
      logCalls.push([message, data])
    })
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
    mock.restore()
  })

  it("uses sh on unix shells and passes correct env vars", async () => {
    // given
    Object.defineProperty(process, "platform", { value: "linux" })
    process.env.SHELL = "/bin/bash"
    delete process.env.PSModulePath
    const spawnCalls: Array<Parameters<typeof spawnWithWindowsHideModule.spawnWithWindowsHide>> = []
    spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation((
      command,
      options,
    ) => {
      spawnCalls.push([command, options])
      return createProc(0)
    })
    const executeOnCompleteHook = await importFreshExecuteOnCompleteHook()

    // when
    await executeOnCompleteHook({
      command: "echo test",
      sessionId: "session-123",
      exitCode: 0,
      durationMs: 5000,
      messageCount: 10,
    })

    // then
    expect(spawnCalls).toHaveLength(1)
    const [args, options] = spawnCalls[0]

    expect(args).toEqual(["sh", "-c", "echo test"])
    expect(options?.env?.SESSION_ID).toBe("session-123")
    expect(options?.env?.EXIT_CODE).toBe("0")
    expect(options?.env?.DURATION_MS).toBe("5000")
    expect(options?.env?.MESSAGE_COUNT).toBe("10")
    expect(options?.stdout).toBe("pipe")
    expect(options?.stderr).toBe("pipe")
  })

  it("uses powershell when PowerShell is detected on Windows", async () => {
    // given
    Object.defineProperty(process, "platform", { value: "win32" })
    process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
    delete process.env.SHELL
    const spawnCalls: Array<Parameters<typeof spawnWithWindowsHideModule.spawnWithWindowsHide>> = []
    spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation((
      command,
      options,
    ) => {
      spawnCalls.push([command, options])
      return createProc(0)
    })
    const executeOnCompleteHook = await importFreshExecuteOnCompleteHook()

    // when
    await executeOnCompleteHook({
      command: "Write-Host done",
      sessionId: "session-123",
      exitCode: 0,
      durationMs: 5000,
      messageCount: 10,
    })

    // then
    const [args] = spawnCalls[0]
    expect(args).toEqual(["powershell.exe", "-NoProfile", "-Command", "Write-Host done"])
  })

  it("uses pwsh when PowerShell is detected on non-Windows platforms", async () => {
    // given
    Object.defineProperty(process, "platform", { value: "linux" })
    process.env.PSModulePath = "/usr/local/share/powershell/Modules"
    delete process.env.SHELL
    const spawnCalls: Array<Parameters<typeof spawnWithWindowsHideModule.spawnWithWindowsHide>> = []
    spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation((
      command,
      options,
    ) => {
      spawnCalls.push([command, options])
      return createProc(0)
    })
    const executeOnCompleteHook = await importFreshExecuteOnCompleteHook()

    // when
    await executeOnCompleteHook({
      command: "Write-Host done",
      sessionId: "session-123",
      exitCode: 0,
      durationMs: 5000,
      messageCount: 10,
    })

    // then
    const [args] = spawnCalls[0]
    expect(args).toEqual(["pwsh", "-NoProfile", "-Command", "Write-Host done"])
  })

  it("falls back to cmd.exe on Windows when PowerShell is not detected", async () => {
    // given
    Object.defineProperty(process, "platform", { value: "win32" })
    delete process.env.PSModulePath
    delete process.env.SHELL
    process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe"
    const spawnCalls: Array<Parameters<typeof spawnWithWindowsHideModule.spawnWithWindowsHide>> = []
    spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation((
      command,
      options,
    ) => {
      spawnCalls.push([command, options])
      return createProc(0)
    })
    const executeOnCompleteHook = await importFreshExecuteOnCompleteHook()

    // when
    await executeOnCompleteHook({
      command: "echo done",
      sessionId: "session-123",
      exitCode: 0,
      durationMs: 5000,
      messageCount: 10,
    })

    // then
    const [args] = spawnCalls[0]
    expect(args).toEqual(["C:\\Windows\\System32\\cmd.exe", "/d", "/s", "/c", "echo done"])
  })

  it("env var values are strings", async () => {
    // given
    const spawnCalls: Array<Parameters<typeof spawnWithWindowsHideModule.spawnWithWindowsHide>> = []
    spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation((
      command,
      options,
    ) => {
      spawnCalls.push([command, options])
      return createProc(0)
    })
    const executeOnCompleteHook = await importFreshExecuteOnCompleteHook()

    // when
    await executeOnCompleteHook({
      command: "echo test",
      sessionId: "session-123",
      exitCode: 1,
      durationMs: 12345,
      messageCount: 42,
    })

    // then
    const [, options] = spawnCalls[0]

    expect(options?.env?.EXIT_CODE).toBe("1")
    expect(options?.env?.EXIT_CODE).toBeTypeOf("string")
    expect(options?.env?.DURATION_MS).toBe("12345")
    expect(options?.env?.DURATION_MS).toBeTypeOf("string")
    expect(options?.env?.MESSAGE_COUNT).toBe("42")
    expect(options?.env?.MESSAGE_COUNT).toBeTypeOf("string")
  })

  it("empty command string is no-op", async () => {
    // given
    const spawnCalls: Array<Parameters<typeof spawnWithWindowsHideModule.spawnWithWindowsHide>> = []
    spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation((
      command,
      options,
    ) => {
      spawnCalls.push([command, options])
      return createProc(0)
    })
    const executeOnCompleteHook = await importFreshExecuteOnCompleteHook()

    // when
    await executeOnCompleteHook({
      command: "",
      sessionId: "session-123",
      exitCode: 0,
      durationMs: 5000,
      messageCount: 10,
    })

    // then
    expect(spawnCalls).toHaveLength(0)
  })

  it("whitespace-only command is no-op", async () => {
    // given
    const spawnCalls: Array<Parameters<typeof spawnWithWindowsHideModule.spawnWithWindowsHide>> = []
    spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation((
      command,
      options,
    ) => {
      spawnCalls.push([command, options])
      return createProc(0)
    })
    const executeOnCompleteHook = await importFreshExecuteOnCompleteHook()

    // when
    await executeOnCompleteHook({
      command: "   ",
      sessionId: "session-123",
      exitCode: 0,
      durationMs: 5000,
      messageCount: 10,
    })

    // then
    expect(spawnCalls).toHaveLength(0)
  })

  it("command failure logs warning but does not throw", async () => {
    // given
    spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockReturnValue(createProc(1))
    const executeOnCompleteHook = await importFreshExecuteOnCompleteHook()

    // when
    await executeOnCompleteHook({
      command: "false",
      sessionId: "session-123",
      exitCode: 0,
      durationMs: 5000,
      messageCount: 10,
    })

    // then
    const warningCall = logCalls.find(
      (call) => call[0] === "On-complete hook exited with non-zero code"
    )
    expect(warningCall).toBeDefined()
  })

  it("spawn error logs warning but does not throw", async () => {
    // given
    const spawnError = new Error("Command not found")
    spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockImplementation(() => {
      throw spawnError
    })
    const executeOnCompleteHook = await importFreshExecuteOnCompleteHook()

    // when
    await executeOnCompleteHook({
      command: "nonexistent-command",
      sessionId: "session-123",
      exitCode: 0,
      durationMs: 5000,
      messageCount: 10,
    })

    // then
    const errorCall = logCalls.find(
      (call) => call[0] === "Failed to execute on-complete hook"
    )
    expect(errorCall).toBeDefined()
  })

  it("hook stdout and stderr are logged to file logger", async () => {
    // given
    spyOn(spawnWithWindowsHideModule, "spawnWithWindowsHide").mockReturnValue(
      createProc(0, { stdout: "hook output\n", stderr: "hook warning\n" })
    )
    const executeOnCompleteHook = await importFreshExecuteOnCompleteHook()

    // when
    await executeOnCompleteHook({
      command: "echo test",
      sessionId: "session-123",
      exitCode: 0,
      durationMs: 5000,
      messageCount: 10,
    })

    // then
    const stdoutCall = logCalls.find(
      (call) => call[0] === "On-complete hook stdout"
    )
    const stderrCall = logCalls.find(
      (call) => call[0] === "On-complete hook stderr"
    )

    expect(stdoutCall?.[1]).toEqual({ command: "echo test", stdout: "hook output" })
    expect(stderrCall?.[1]).toEqual({ command: "echo test", stderr: "hook warning" })
  })
})
