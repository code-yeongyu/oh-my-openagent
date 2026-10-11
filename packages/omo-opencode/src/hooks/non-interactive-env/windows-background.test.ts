import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  createNonInteractiveEnvHook,
  WINDOWS_BACKGROUND_COMMAND_MESSAGE,
} from "./index"

type HookOutput = { args: Record<string, unknown>; message?: string }

describe("native Windows background command guard", () => {
  const mockCtx = {} as Parameters<typeof createNonInteractiveEnvHook>[0]

  let originalPlatform: NodeJS.Platform
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalPlatform = process.platform
    originalEnv = {
      SHELL: process.env.SHELL,
      MSYSTEM: process.env.MSYSTEM,
    }
    Object.defineProperty(process, "platform", { value: "linux" })
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
  })

  test("#given native Windows Git Bash #when nohup backgrounds a long-lived command #then rejects before spawning", async () => {
    process.env.SHELL = "/usr/bin/bash"
    process.env.MSYSTEM = "MINGW64"
    Object.defineProperty(process, "platform", { value: "win32" })

    const hook = createNonInteractiveEnvHook(mockCtx)
    const originalCommand = "nohup bun run dev &"
    const output: HookOutput = { args: { command: originalCommand } }

    let rejectedError: Error | undefined
    try {
      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error
      }
      rejectedError = error
    }

    expect(rejectedError).toBeInstanceOf(Error)
    expect(rejectedError?.message).toBe(WINDOWS_BACKGROUND_COMMAND_MESSAGE)
    expect(output.args.command).toBe(originalCommand)
  })

  test("#given native Windows #when a trailing single ampersand backgrounds a command #then rejects before spawning", async () => {
    delete process.env.SHELL
    delete process.env.MSYSTEM
    Object.defineProperty(process, "platform", { value: "win32" })

    const hook = createNonInteractiveEnvHook(mockCtx)
    const originalCommand = "bun run dev &"
    const output: HookOutput = { args: { command: originalCommand } }

    let rejectedError: Error | undefined
    try {
      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error
      }
      rejectedError = error
    }

    expect(rejectedError).toBeInstanceOf(Error)
    expect(rejectedError?.message).toBe(WINDOWS_BACKGROUND_COMMAND_MESSAGE)
    expect(output.args.command).toBe(originalCommand)
  })

  test("#given native Windows #when a chained command uses && #then it is not treated as backgrounding", async () => {
    delete process.env.SHELL
    delete process.env.MSYSTEM
    Object.defineProperty(process, "platform", { value: "win32" })

    const hook = createNonInteractiveEnvHook(mockCtx)
    const output: HookOutput = {
      args: { command: "bun run build && bun test" },
    }

    await hook["tool.execute.before"](
      { tool: "bash", sessionID: "test", callID: "1" },
      output
    )

    expect(output.args.command).toBe("bun run build && bun test")
    expect(output.message).toBeUndefined()
  })

  test("#given native Windows #when Start-Process launches a command #then it is not treated as POSIX backgrounding", async () => {
    delete process.env.SHELL
    delete process.env.MSYSTEM
    Object.defineProperty(process, "platform", { value: "win32" })

    const hook = createNonInteractiveEnvHook(mockCtx)
    const output: HookOutput = {
      args: {
        command: "Start-Process -FilePath bun -ArgumentList 'run','dev'",
      },
    }

    await hook["tool.execute.before"](
      { tool: "bash", sessionID: "test", callID: "1" },
      output
    )

    expect(output.args.command).toBe(
      "Start-Process -FilePath bun -ArgumentList 'run','dev'"
    )
    expect(output.message).toBeUndefined()
  })

  test("#given a non-Windows platform #when nohup backgrounds a command #then it remains unchanged", async () => {
    process.env.SHELL = "/bin/bash"
    delete process.env.MSYSTEM
    Object.defineProperty(process, "platform", { value: "linux" })

    const hook = createNonInteractiveEnvHook(mockCtx)
    const output: HookOutput = {
      args: { command: "nohup bun run dev &" },
    }

    await hook["tool.execute.before"](
      { tool: "bash", sessionID: "test", callID: "1" },
      output
    )

    expect(output.args.command).toBe("nohup bun run dev &")
    expect(output.message).toBeUndefined()
  })
})
