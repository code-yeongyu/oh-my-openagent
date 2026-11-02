import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import { createPluginInterface } from "./plugin-interface"
import { createKeywordDetectorHook } from "./hooks/keyword-detector"
import { getUltraworkMessage } from "./hooks/keyword-detector/ultrawork"
import { createAutoSlashCommandHook } from "./hooks/auto-slash-command"
import { createUlwExecuteHook } from "./hooks/ulw-execute"
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
    testDir = join(tmpdir(), `plugin-interface-ulw-execute-${randomUUID()}`)
    mkdirSync(join(testDir, ".omo", "plans"), { recursive: true })
    writeFileSync(join(testDir, ".omo", "plans", "worker-plan.md"), "# Plan\n- [ ] Task 1")
    _resetForTesting()
    registerAgentName("prometheus")
    registerAgentName("sisyphus")
  })

  afterEach(() => {
    _resetForTesting()
    rmSync(testDir, { recursive: true, force: true })
  })

  test("executes ulw-execute side effects for native command execution", async () => {
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
        ulwExecute: createUlwExecuteHook({
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
        command: "ulw-execute",
        sessionID: "ses-command-before",
        arguments: "",
      },
      output as never
    )

    // then
    expect(pluginInterface["command.execute.before"]).toBeDefined()
    expect(output.parts[0]?.text).toContain("<!-- omo-ulw-execute-context -->")
    expect(getSessionAgent("ses-command-before")).toBe("sisyphus")
    expect(readBoulderState(testDir)?.agent).toBe("sisyphus")
    expect(readBoulderState(testDir)?.plan_name).toBe("worker-plan")
  })

  test("does not run ulw-execute side effects for other native commands with session context", async () => {
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
        ulwExecute: createUlwExecuteHook({
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
    expect(readBoulderState(testDir)).toBeNull()
    expect(getSessionAgent("ses-handoff")).toBe("prometheus")
  })

  test("switches native ulw-execute to Atlas when Atlas is registered in config", async () => {
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
        ulwExecute: createUlwExecuteHook({
          directory: testDir,
          client: { tui: { showToast: async () => {} } },
        } as never),
      } as never,
      tools: {},
    })
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "/ulw-execute" }],
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
    expect(output.message.agent).toBe("atlas")
    expect(getSessionAgent("ses-command-atlas")).toBe("atlas")
    expect(readBoulderState(testDir)?.agent).toBe("atlas")
  })
})

describe("createPluginInterface - goal native command smoke", () => {
  let testDir = ""

  beforeEach(() => {
    testDir = join(tmpdir(), `plugin-interface-goal-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    _resetForTesting()
    registerAgentName("sisyphus")
  })

  afterEach(() => {
    _resetForTesting()
    rmSync(testDir, { recursive: true, force: true })
  })

  test("starts the goal from the native command flow with parsed arguments intact", async () => {
    // given
    const setGoalCalls: Array<{ sessionID: string; objective: string }> = []
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
        goal: {
          setGoal: (sessionID: string, objective: string) => {
            setGoalCalls.push({ sessionID, objective })
            return { id: "goal-1", sessionID, objective, status: "active" } as never
          },
          getGoal: () => null,
          pauseGoal: () => null,
          resumeGoal: () => null,
          clearGoal: () => false,
          markComplete: () => null,
          event: async () => {},
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
        command: "goal",
        sessionID: "ses-goal-native",
        arguments: "Ship feature",
      },
      output as never,
    )
    await pluginInterface["chat.message"]?.(
      {
        sessionID: "ses-goal-native",
        agent: "sisyphus",
      } as never,
      output as never,
    )

    // then
    expect(setGoalCalls).toEqual([
      {
        sessionID: "ses-goal-native",
        objective: "Ship feature",
      },
    ])
  })
})

describe("createPluginInterface - post-compaction ULW restoration", () => {
  test("keeps runtime guidance in system transforms until a real message restores it", async () => {
    const sessionID = "ses-system-ulw"
    const keywordDetector = createKeywordDetectorHook(unsafeTestValue<PluginInput>({
      client: { tui: { showToast: async () => {} } },
    }))
    const pluginInterface = createPluginInterface({
      ctx: { directory: tmpdir(), client: { tui: { showToast: async () => {} } } } as never,
      pluginConfig: {} as never,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {} as never,
      hooks: { keywordDetector } as never,
      tools: {},
    })
    const initial = {
      message: { id: "msg-system-ulw-initial" },
      parts: [{ type: "text", text: "ulw initial" }],
    }
    await keywordDetector["chat.message"]({ sessionID, agent: "sisyphus", model: { providerID: "openai", modelID: "gpt-fake" } }, initial)
    const guidance = initial.parts[0].text.slice(initial.parts[0].text.indexOf("<ultrawork-mode>"))
    keywordDetector.event({ event: { type: "session.compacted", properties: { sessionID } } })
    const renderSystem = async (modelID = "gpt-fake") => {
      const output = { system: ["base system prompt"] }
      await pluginInterface["experimental.chat.system.transform"]?.(
        { sessionID, model: { id: modelID, providerID: "openai" } },
        output,
      )
      return output
    }

    const firstResumeSystem = await renderSystem()
    const secondResumeSystem = await renderSystem()
    const changedModelSystem = await renderSystem("gemini-3-pro")
    const durableMessage = {
      message: { id: "msg-system-ulw-durable" },
      parts: [{ type: "text", text: "continue after compaction" }],
    }
    await keywordDetector["chat.message"]({ sessionID, agent: "sisyphus" }, durableMessage)
    const restoredSystem = await renderSystem()
    const followingMessage = {
      message: { id: "msg-system-ulw-followup" },
      parts: [{ type: "text", text: "continue" }],
    }
    await keywordDetector["chat.message"]({ sessionID, agent: "sisyphus" }, followingMessage)

    expect({
      guidanceStable: firstResumeSystem.system.at(-1) === guidance && secondResumeSystem.system.at(-1) === guidance,
      runtimeModelSelected: changedModelSystem.system.at(-1) === getUltraworkMessage("sisyphus", "gemini-3-pro"),
      durableMessageRestored: durableMessage.parts[0].text.includes("<ultrawork-mode>"),
      systemRestorationCleared: restoredSystem.system.every((part) => !part.includes("<ultrawork-mode>")),
      followingMessageCompact: followingMessage.parts.some((part) => part.synthetic === true),
    }).toEqual({
      guidanceStable: true,
      runtimeModelSelected: true,
      durableMessageRestored: true,
      systemRestorationCleared: true,
      followingMessageCompact: true,
    })
  })
})

describe("createPluginInterface - backward compatibility", () => {
  beforeEach(() => {
    _resetForTesting()
    registerAgentName("hephaestus")
  })

  afterEach(() => {
    _resetForTesting()
  })

  test("strips legacy ZWSP-prefixed agent names from persisted chat.message session state (GH-3259)", async () => {
    // given - persisted session payload from v3.14.0-v3.16.0 with ZWSP prefix
    const pluginInterface = createPluginInterface({
      ctx: {
        directory: tmpdir(),
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
      hooks: {} as never,
      tools: {},
    })
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hello" }],
    }

    // when
    await pluginInterface["chat.message"]?.(
      {
        sessionID: "ses-legacy-zwsp",
        agent: "\u200B\u200BHephaestus - Deep Agent",
      } as never,
      output as never,
    )

    // then
    expect(getSessionAgent("ses-legacy-zwsp")).toBe("Hephaestus - Deep Agent")
  })
})

describe("createPluginInterface - chat.params variant injection", () => {
  test("injects variant from agent config into chat.params message", async () => {
    // given
    const pluginInterface = createPluginInterface({
      ctx: { client: {} } as never,
      pluginConfig: {
        agents: {
          sisyphus: { variant: "max" },
        },
      } as never,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {} as never,
      hooks: {} as never,
      tools: {},
    })
    const input = {
      sessionID: "ses-variant-inject",
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      provider: { id: "anthropic" },
      message: {} as { variant?: string },
    }
    const output = { options: {} }

    // when
    await pluginInterface["chat.params"]?.(input as never, output as never)

    // then
    expect(input.message.variant).toBe("max")
  })

  test("does not overwrite existing variant in chat.params message", async () => {
    // given
    const pluginInterface = createPluginInterface({
      ctx: { client: {} } as never,
      pluginConfig: {
        agents: {
          sisyphus: { variant: "max" },
        },
      } as never,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {} as never,
      hooks: {} as never,
      tools: {},
    })
    const input = {
      sessionID: "ses-variant-keep",
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      provider: { id: "anthropic" },
      message: { variant: "high" } as { variant?: string },
    }
    const output = { options: {} }

    // when
    await pluginInterface["chat.params"]?.(input as never, output as never)

    // then
    expect(input.message.variant).toBe("high")
  })
})
