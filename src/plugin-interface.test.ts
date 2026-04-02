import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { createPluginInterface } from "./plugin-interface"
import { createAutoSlashCommandHook } from "./hooks/auto-slash-command"
import { createStartWorkHook } from "./hooks/start-work"
import { getAgentListDisplayName } from "./shared/agent-display-names"
import { readBoulderState } from "./features/boulder-state"
import {
  _resetForTesting,
  getSessionAgent,
  registerAgentName,
  updateSessionAgent,
} from "./features/claude-code-session-state"

describe("createPluginInterface - command.execute.before", () => {
  let testDir = ""

  beforeEach(() => {
    testDir = join(tmpdir(), `plugin-interface-start-work-${randomUUID()}`)
    mkdirSync(join(testDir, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(join(testDir, ".sisyphus", "plans", "worker-plan.md"), "# Plan\n- [ ] Task 1")
    _resetForTesting()
    registerAgentName("prometheus")
    registerAgentName("sisyphus")
  })

  afterEach(() => {
    _resetForTesting()
    rmSync(testDir, { recursive: true, force: true })
  })

  test("executes start-work side effects for native command execution", async () => {
    // given
    updateSessionAgent("ses-command-before", "prometheus")
    const pluginInterface = createPluginInterface({
      ctx: {
        directory: testDir,
        client: { tui: { showToast: async () => {} } },
      } as never,
      pluginConfig: {} as never,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {} as never,
      hooks: {
        autoSlashCommand: createAutoSlashCommandHook({ skills: [] }),
        startWork: createStartWorkHook({
          directory: testDir,
          client: { tui: { showToast: async () => {} } },
        } as never),
      } as never,
      tools: {},
    })
    const output = {
      parts: [{ type: "text", text: "original" }],
    }

    // when
    await pluginInterface["command.execute.before"]?.(
      {
        command: "start-work",
        sessionID: "ses-command-before",
        arguments: "",
      },
      output as never
    )

    // then
    expect(pluginInterface["command.execute.before"]).toBeDefined()
    expect(output.parts[0]?.text).toContain("Auto-Selected Plan")
    expect(output.parts[0]?.text).toContain("boulder.json has been created")
    expect(getSessionAgent("ses-command-before")).toBe("sisyphus")
    expect(readBoulderState(testDir)?.agent).toBe("sisyphus")
  })

  test("does not run start-work side effects for other native commands with session context", async () => {
    // given
    updateSessionAgent("ses-handoff", "prometheus")
    const pluginInterface = createPluginInterface({
      ctx: {
        directory: testDir,
        client: { tui: { showToast: async () => {} } },
      } as never,
      pluginConfig: {} as never,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {} as never,
      hooks: {
        autoSlashCommand: createAutoSlashCommandHook({ skills: [] }),
        startWork: createStartWorkHook({
          directory: testDir,
          client: { tui: { showToast: async () => {} } },
        } as never),
      } as never,
      tools: {},
    })
    const output = {
      parts: [{ type: "text", text: "original" }],
    }

    // when
    await pluginInterface["command.execute.before"]?.(
      {
        command: "handoff",
        sessionID: "ses-handoff",
        arguments: "",
      },
      output as never
    )

    // then
    expect(output.parts[0]?.text).toContain("HANDOFF CONTEXT")
    expect(readBoulderState(testDir)).toBeNull()
    expect(getSessionAgent("ses-handoff")).toBe("prometheus")
  })

  test("switches native start-work to Atlas when Atlas is registered in config", async () => {
    // given
    registerAgentName("atlas")
    updateSessionAgent("ses-command-atlas", "prometheus")
    const pluginInterface = createPluginInterface({
      ctx: {
        directory: testDir,
        client: { tui: { showToast: async () => {} } },
      } as never,
      pluginConfig: {} as never,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {} as never,
      hooks: {
        autoSlashCommand: createAutoSlashCommandHook({ skills: [] }),
        startWork: createStartWorkHook({
          directory: testDir,
          client: { tui: { showToast: async () => {} } },
        } as never),
      } as never,
      tools: {},
    })
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "/start-work" }],
    }

    // when
    await pluginInterface["chat.message"]?.(
      {
        sessionID: "ses-command-atlas",
        agent: "prometheus",
      } as never,
      output as never
    )

    // then
    expect(output.message.agent).toBe(getAgentListDisplayName("atlas"))
    expect(getSessionAgent("ses-command-atlas")).toBe("atlas")
    expect(readBoulderState(testDir)?.agent).toBe("atlas")
  })
})

describe("createPluginInterface - ulw-loop native command smoke", () => {
  let testDir = ""

  beforeEach(() => {
    testDir = join(tmpdir(), `plugin-interface-ulw-loop-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    _resetForTesting()
    registerAgentName("sisyphus")
  })

  afterEach(() => {
    _resetForTesting()
    rmSync(testDir, { recursive: true, force: true })
  })

  test("starts the ultrawork loop from the native command flow with parsed arguments intact", async () => {
    // given
    const startLoopCalls: Array<{
      sessionID: string
      prompt: string
      options: Record<string, unknown>
    }> = []
    const pluginInterface = createPluginInterface({
      ctx: {
        directory: testDir,
        client: { tui: { showToast: async () => {} } },
      } as never,
      pluginConfig: {} as never,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {} as never,
      hooks: {
        autoSlashCommand: createAutoSlashCommandHook({ skills: [] }),
        ralphLoop: {
          startLoop: (sessionID: string, prompt: string, options?: Record<string, unknown>) => {
            startLoopCalls.push({ sessionID, prompt, options: options ?? {} })
            return true
          },
          cancelLoop: () => true,
          getState: () => null,
        },
      } as never,
      tools: {},
    })
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "original" }],
    }

    // when
    await pluginInterface["command.execute.before"]?.(
      {
        command: "ulw-loop",
        sessionID: "ses-ulw-native",
        arguments: '"Ship feature" --strategy=continue',
      },
      output as never,
    )
    await pluginInterface["chat.message"]?.(
      {
        sessionID: "ses-ulw-native",
        agent: "sisyphus",
      } as never,
      output as never,
    )

    // then
    expect(output.parts[0]?.text).toContain("/ulw-loop Command")
    expect(startLoopCalls).toEqual([
      {
        sessionID: "ses-ulw-native",
        prompt: "Ship feature",
        options: {
          ultrawork: true,
          maxIterations: undefined,
          completionPromise: undefined,
          strategy: "continue",
        },
      },
    ])
  })
})
