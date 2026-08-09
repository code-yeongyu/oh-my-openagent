import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { createPluginInterface } from "./plugin-interface"
import { createAutoSlashCommandHook } from "./hooks/auto-slash-command"
import { createStartWorkHook } from "./hooks/start-work"
import { readBoulderState } from "./features/boulder-state"
import {
  _resetForTesting,
  getSessionAgent,
  registerAgentName,
  updateSessionAgent,
} from "./features/claude-code-session-state"
import { clearSessionPromptParams, setSessionPromptParams } from "./shared"


describe("createPluginInterface - command.execute.before", () => {
  let testDir = ""

  beforeEach(() => {
    testDir = join(tmpdir(), `plugin-interface-start-work-${randomUUID()}`)
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
    expect(output.parts[0]?.text).toContain("/goal <objective>")
    expect(setGoalCalls).toEqual([
      {
        sessionID: "ses-goal-native",
        objective: "Ship feature",
      },
    ])
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
  test("injects canonical agent primary provider options and max tokens", async () => {
    const pluginInterface = createPluginInterface({
      ctx: { client: {} } as never,
      pluginConfig: {
        agents: {
          explore: {
            providerOptions: { serviceTier: "priority", textVerbosity: "low" },
            maxTokens: 1024,
          },
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
      sessionID: "ses-agent-primary-options",
      agent: "explore",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      provider: { id: "openai" },
      message: {},
    }
    const output = { options: {} as Record<string, unknown> } as {
      options: Record<string, unknown>
      maxOutputTokens?: number
    }

    await pluginInterface["chat.params"]?.(input as never, output as never)

    expect(output.options).toMatchObject({ serviceTier: "priority", textVerbosity: "low" })
    expect(output.maxOutputTokens).toBe(1024)
  })

  test("injects a canonical category primary rung for an agent category override", async () => {
    const pluginInterface = createPluginInterface({
      ctx: { client: {} } as never,
      pluginConfig: {
        agents: { explore: { category: "research" } },
        categories: {
          research: {
            reasoning: "low",
            models: [{
              model: "anthropic/claude-sonnet-4-6",
              reasoning: "high",
              temperature: 0.2,
              maxTokens: 1024,
              provider_options: { serviceTier: "priority" },
            }],
          },
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
      sessionID: "ses-agent-category-primary",
      agent: "explore",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      provider: { id: "anthropic" },
      message: {} as { variant?: string; reasoningEffort?: string },
    }
    const output = { options: {} as Record<string, unknown> } as {
      options: Record<string, unknown>
      temperature?: number
      maxOutputTokens?: number
    }

    await pluginInterface["chat.params"]?.(input as never, output as never)

    expect(output).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 1024,
      options: { serviceTier: "priority" },
    })
    expect([input.message.variant, input.message.reasoningEffort]).toContain("high")
  })

  test("does not inject category primary rung settings into another model", async () => {
    const pluginInterface = createPluginInterface({
      ctx: { client: {} } as never,
      pluginConfig: {
        agents: { explore: { category: "research" } },
        categories: {
          research: {
            models: [{
              model: "openai/gpt-5.6-sol-primary",
              reasoning: "high",
              max_tokens: 1024,
              provider_options: { serviceTier: "priority" },
            }],
          },
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
      sessionID: "ses-agent-category-other-model",
      agent: "explore",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      provider: { id: "openai" },
      message: {} as { variant?: string; reasoningEffort?: string },
    }
    const output = { options: {} as Record<string, unknown> } as {
      options: Record<string, unknown>
      maxOutputTokens?: number
    }

    await pluginInterface["chat.params"]?.(input as never, output as never)

    expect(output.maxOutputTokens).toBeUndefined()
    expect(output.options.serviceTier).toBeUndefined()
    expect(input.message.variant).toBeUndefined()
    expect(input.message.reasoningEffort).toBeUndefined()
  })

  test.each([
    ["Prometheus - Plan Builder", "prometheus", undefined],
    ["計畫師", "prometheus", "計畫師"],
  ])("resolves agent display name %s to primary settings", async (agent, key, displayName) => {
    const pluginInterface = createPluginInterface({
      ctx: { client: {} } as never,
      pluginConfig: {
        agents: {
          [key]: {
            displayName,
            models: ["openai/gpt-5.6-sol"],
            reasoning: "high",
            providerOptions: { serviceTier: "priority" },
            maxTokens: 1024,
          },
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
    const output = { options: {} as Record<string, unknown>, maxOutputTokens: undefined }

    const input = {
      sessionID: `ses-${key}`,
      agent,
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      provider: { id: "openai" },
      message: {} as { variant?: string },
    }

    await pluginInterface["chat.params"]?.(input as never, output as never)

    expect(output.options.serviceTier).toBe("priority")
    expect(output.maxOutputTokens).toBe(1024)
    expect(input.message.variant).toBe("high")
  })

  test("injects primary reasoningEffort when canonical reasoning is absent", async () => {
    const pluginInterface = createPluginInterface({
      ctx: { client: {} } as never,
      pluginConfig: {
        agents: {
          explore: {
            models: ["openai/gpt-5.6-sol"],
            reasoningEffort: "high",
            top_p: 0.8,
            thinking: { type: "enabled", budgetTokens: 1024 },
            textVerbosity: "low",
          },
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
    const output = { options: {} as Record<string, unknown>, topP: undefined }

    await pluginInterface["chat.params"]?.({
      sessionID: "ses-agent-primary-reasoning",
      agent: "explore",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      provider: { id: "openai" },
      message: {},
    } as never, output as never)

    expect(output.options.reasoningEffort).toBe("high")
    expect(output.options.thinking).toEqual({ type: "enabled", budgetTokens: 1024 })
    expect(output.options.textVerbosity).toBe("low")
    expect(output.topP).toBe(0.8)
  })

  test("does not leak primary agent settings into a session-scoped fallback rung", async () => {
    const sessionID = "ses-agent-fallback-options"
    setSessionPromptParams(sessionID, {})
    const pluginInterface = createPluginInterface({
      ctx: { client: {} } as never,
      pluginConfig: {
        agents: { explore: { providerOptions: { serviceTier: "priority" }, maxTokens: 1024 } },
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
      sessionID,
      agent: "explore",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      provider: { id: "openai" },
      message: {},
    }
    const output = { options: {} as Record<string, unknown> } as {
      options: Record<string, unknown>
      maxOutputTokens?: number
    }

    await pluginInterface["chat.params"]?.(input as never, output as never)
    clearSessionPromptParams(sessionID)

    expect(output.options.serviceTier).toBeUndefined()
    expect(output.maxOutputTokens).toBeUndefined()
  })

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
