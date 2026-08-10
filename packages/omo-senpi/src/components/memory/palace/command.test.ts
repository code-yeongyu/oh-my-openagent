import { afterAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { registerPalaceCommand, type PalaceCommandContext } from "./command"
import { cleanupPalaceFixtures, createPalaceFixture, type PalaceFixture } from "./palace.test-support"

afterAll(cleanupPalaceFixtures)

interface ExecCall {
  readonly command: string
  readonly args: readonly string[]
}

function commandContext(options: {
  readonly platform?: NodeJS.Platform
  readonly env?: Record<string, string | undefined>
  readonly hasUI?: boolean
}): {
  readonly ctx: PalaceCommandContext
  readonly execCalls: ExecCall[]
  readonly notifications: Array<{ message: string; level?: string }>
  readonly outputs: string[]
} {
  const execCalls: ExecCall[] = []
  const notifications: Array<{ message: string; level?: string }> = []
  const outputs: string[] = []
  return {
    execCalls,
    notifications,
    outputs,
    ctx: {
      hasUI: options.hasUI ?? true,
      platform: options.platform ?? "darwin",
      env: options.env ?? {},
      ui: { notify: (message, level) => notifications.push({ message, level }) },
      output: (text) => outputs.push(text),
      exec: async (command, args) => {
        execCalls.push({ command, args })
        return { code: 0, stdout: "", stderr: "" }
      },
    },
  }
}

async function runPalace(
  fixture: PalaceFixture,
  ctx: PalaceCommandContext,
): Promise<MemoryFakeExtensionAPI> {
  const pi = new MemoryFakeExtensionAPI()
  registerPalaceCommand(pi, () => fixture.context)
  const registration = pi.commands.find((entry) => entry.name === "palace")
  if (registration === undefined) throw new Error("palace command was not registered")
  const handler = registration.options.handler
  if (typeof handler !== "function") throw new Error("palace command has no handler")
  await Reflect.apply(handler, registration.options, ["", ctx])
  return pi
}

describe("palace command", () => {
  test("#given a bound identity #when the palace command is registered #then it exposes a description and handler", () => {
    const pi = new MemoryFakeExtensionAPI()

    registerPalaceCommand(pi, () => undefined)

    const registration = pi.commands.find((entry) => entry.name === "palace")
    expect(typeof registration?.options.description).toBe("string")
    expect(typeof registration?.options.handler).toBe("function")
  })

  test("#given darwin without remote-session env #when /palace runs #then the generated file is opened with open", async () => {
    const fixture = await createPalaceFixture()
    const surface = commandContext({ platform: "darwin" })

    await runPalace(fixture, surface.ctx)

    expect(surface.execCalls).toHaveLength(1)
    expect(surface.execCalls[0]?.command).toBe("open")
    const opened = surface.execCalls[0]?.args[0]
    expect(opened).toBeDefined()
    expect(existsSync(String(opened))).toBe(true)
  })

  test("#given linux and win32 hosts #when /palace runs #then the platform opener is used", async () => {
    const fixture = await createPalaceFixture()
    const linux = commandContext({ platform: "linux" })
    const windows = commandContext({ platform: "win32" })

    await runPalace(fixture, linux.ctx)
    await runPalace(fixture, windows.ctx)

    expect(linux.execCalls[0]?.command).toBe("xdg-open")
    expect(windows.execCalls[0]?.command).toBe("start")
  })

  test("#given a tmux or ssh session #when /palace runs #then the path is printed instead of opened", async () => {
    const fixture = await createPalaceFixture()
    const tmux = commandContext({ env: { TMUX: "/tmp/tmux-1000/default,1,0" } })
    const ssh = commandContext({ env: { SSH_CONNECTION: "10.0.0.2 22 10.0.0.1 22" } })

    await runPalace(fixture, tmux.ctx)
    await runPalace(fixture, ssh.ctx)

    expect(tmux.execCalls).toHaveLength(0)
    expect(ssh.execCalls).toHaveLength(0)
    expect(tmux.notifications[0]?.message).toMatch(/[\\/]viewers[\\/]palace-/)
    expect(ssh.notifications[0]?.message).toMatch(/[\\/]viewers[\\/]palace-/)
  })

  test("#given a headless context #when /palace runs #then the path is returned as command output text", async () => {
    const fixture = await createPalaceFixture()
    const headless = commandContext({ hasUI: false })

    await runPalace(fixture, headless.ctx)

    expect(headless.execCalls).toHaveLength(0)
    expect(headless.notifications).toHaveLength(0)
    expect(headless.outputs).toHaveLength(1)
    expect(existsSync(String(headless.outputs[0]))).toBe(true)
  })

  test("#given no bound memory identity #when /palace runs #then it reports the unbound state without generating a file", async () => {
    const surface = commandContext({})
    const pi = new MemoryFakeExtensionAPI()
    registerPalaceCommand(pi, () => undefined)
    const registration = pi.commands.find((entry) => entry.name === "palace")
    const handler = registration?.options.handler
    if (typeof handler !== "function") throw new Error("palace command has no handler")

    await Reflect.apply(handler, registration?.options, ["", surface.ctx])

    expect(surface.execCalls).toHaveLength(0)
    expect(surface.notifications[0]?.message).toContain("memory is not bound")
    expect(surface.notifications[0]?.level).toBe("warning")
  })
})
