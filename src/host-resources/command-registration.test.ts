import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerTargetCommands, type TargetCommandOptions } from "./command-registration"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "omo-target-commands-"))
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

describe("registerTargetCommands", () => {
  test("#given target command API #when registered #then builtin command executes through user message", async () => {
    const commands = new Map<string, TargetCommandOptions>()
    const messages: string[] = []
    registerTargetCommands(
      {
        registerCommand: (name, command) => commands.set(name, command),
        sendUserMessage: (content) => {
          messages.push(content)
        },
      },
      { cwd },
    )

    await commands.get("handoff")?.handler("port context", { cwd, ui: { notify: () => {} } })
    expect(commands.has("start-work")).toBe(true)
    expect(messages[0]).toContain("port context")
    expect(messages[0]).not.toContain("$ARGUMENTS")
  })

  test("#given fire-and-forget target message dispatch #when command runs #then handler waits for the dispatched turn", async () => {
    const commands = new Map<string, TargetCommandOptions>()
    let idle = true
    let waitCount = 0
    registerTargetCommands(
      {
        registerCommand: (name, command) => commands.set(name, command),
        sendUserMessage: () => {
          queueMicrotask(() => {
            idle = false
          })
        },
      },
      { cwd },
    )

    await commands.get("cancel-ralph")?.handler("", {
      cwd,
      isIdle: () => idle,
      waitForIdle: async () => {
        waitCount += 1
        if (waitCount > 1) idle = true
      },
      ui: { notify: () => {} },
    })

    expect(idle).toBe(true)
    expect(waitCount).toBe(2)
  })

  test("#given canonical and legacy command files #when discovered #then agents command wins", async () => {
    mkdirSync(join(cwd, ".agents", "command"), { recursive: true })
    mkdirSync(join(cwd, ".opencode", "command"), { recursive: true })
    writeFileSync(join(cwd, ".agents", "command", "custom.md"), "---\ndescription: canonical\n---\ncanonical $ARGUMENTS")
    writeFileSync(join(cwd, ".opencode", "command", "custom.md"), "---\ndescription: legacy\n---\nlegacy $ARGUMENTS")
    const commands = new Map<string, TargetCommandOptions>()
    const messages: string[] = []
    registerTargetCommands(
      {
        registerCommand: (name, command) => commands.set(name, command),
        sendUserMessage: (content) => {
          messages.push(content)
        },
      },
      { cwd },
    )

    await commands.get("custom")?.handler("argument", { cwd, ui: { notify: () => {} } })
    expect(commands.get("custom")?.description).toBe("canonical")
    expect(messages).toEqual(["canonical argument"])
  })
})
