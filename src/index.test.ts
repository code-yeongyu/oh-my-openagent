import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"

describe("experimental.session.compacting handler", () => {
  function createCompactingHandler(hooks: {
    compactionContextInjector?: {
      capture: (sessionID: string) => Promise<void>
      inject: (sessionID: string) => string
    }
    compactionTodoPreserver?: { capture: (sessionID: string) => Promise<void> }
    claudeCodeHooks?: {
      "experimental.session.compacting"?: (
        input: { sessionID: string },
        output: { context: string[] },
      ) => Promise<void>
    }
  }) {
    return async (
      _input: { sessionID: string },
      output: { context: string[] },
    ): Promise<void> => {
      await hooks.compactionContextInjector?.capture(_input.sessionID)
      await hooks.compactionTodoPreserver?.capture(_input.sessionID)
      await hooks.claudeCodeHooks?.["experimental.session.compacting"]?.(
        _input,
        output,
      )
      if (hooks.compactionContextInjector) {
        output.context.push(hooks.compactionContextInjector.inject(_input.sessionID))
      }
    }
  }

  //#given all three hooks are present
  //#when compacting handler is invoked
  //#then all hooks are called in order: capture → PreCompact → contextInjector
  it("calls claudeCodeHooks PreCompact alongside other hooks", async () => {
    const callOrder: string[] = []

    const handler = createCompactingHandler({
      compactionContextInjector: {
        capture: mock(async () => {
          callOrder.push("checkpointCapture")
        }),
        inject: mock((sessionID: string) => {
          callOrder.push("contextInjector")
          return `context-for-${sessionID}`
        }),
      },
      compactionTodoPreserver: {
        capture: mock(async () => { callOrder.push("capture") }),
      },
      claudeCodeHooks: {
        "experimental.session.compacting": mock(async () => {
          callOrder.push("preCompact")
        }),
      },
    })

    const output = { context: [] as string[] }
    await handler({ sessionID: "ses_test" }, output)

    expect(callOrder).toEqual(["checkpointCapture", "capture", "preCompact", "contextInjector"])
    expect(output.context).toEqual(["context-for-ses_test"])
  })

  //#given claudeCodeHooks injects context during PreCompact
  //#when compacting handler is invoked
  //#then injected context from PreCompact is preserved in output
  it("preserves context injected by PreCompact hooks", async () => {
    const handler = createCompactingHandler({
      claudeCodeHooks: {
        "experimental.session.compacting": async (_input, output) => {
          output.context.push("precompact-injected-context")
        },
      },
    })

    const output = { context: [] as string[] }
    await handler({ sessionID: "ses_test" }, output)

    expect(output.context).toContain("precompact-injected-context")
  })

  //#given claudeCodeHooks is null (no claude code hooks configured)
  //#when compacting handler is invoked
  //#then handler completes without error and other hooks still run
  it("handles null claudeCodeHooks gracefully", async () => {
    const captureMock = mock(async () => {})
    const checkpointCaptureMock = mock(async () => {})
    const contextMock = mock(() => "injected-context")

    const handler = createCompactingHandler({
      compactionContextInjector: {
        capture: checkpointCaptureMock,
        inject: contextMock,
      },
      compactionTodoPreserver: { capture: captureMock },
      claudeCodeHooks: undefined,
    })

    const output = { context: [] as string[] }
    await handler({ sessionID: "ses_test" }, output)

    expect(checkpointCaptureMock).toHaveBeenCalledWith("ses_test")
    expect(captureMock).toHaveBeenCalledWith("ses_test")
    expect(contextMock).toHaveBeenCalledWith("ses_test")
    expect(output.context).toEqual(["injected-context"])
  })

  //#given compactionContextInjector is null
  //#when compacting handler is invoked
  //#then handler does not early-return, PreCompact hooks still execute
  it("does not early-return when compactionContextInjector is null", async () => {
    const preCompactMock = mock(async () => {})

    const handler = createCompactingHandler({
      claudeCodeHooks: {
        "experimental.session.compacting": preCompactMock,
      },
      compactionContextInjector: undefined,
    })

    const output = { context: [] as string[] }
    await handler({ sessionID: "ses_test" }, output)

    expect(preCompactMock).toHaveBeenCalled()
    expect(output.context).toEqual([])
  })
})

/**
 * Tests for conditional tool registration logic in index.ts
 * 
 * The actual plugin initialization is complex to test directly,
 * so we test the underlying logic that determines tool registration.
 */
describe("look_at tool conditional registration", () => {
  describe("isMultimodalLookerEnabled logic", () => {
    // given multimodal-looker is in disabled_agents
    // when checking if agent is enabled
    // then should return false (disabled)
    it("returns false when multimodal-looker is disabled (exact case)", () => {
      const disabledAgents: string[] = ["multimodal-looker"]
      const isEnabled = !disabledAgents.some(
        (agent) => agent.toLowerCase() === "multimodal-looker"
      )
      expect(isEnabled).toBe(false)
    })

    // given multimodal-looker is in disabled_agents with different case
    // when checking if agent is enabled
    // then should return false (case-insensitive match)
    it("returns false when multimodal-looker is disabled (case-insensitive)", () => {
      const disabledAgents: string[] = ["Multimodal-Looker"]
      const isEnabled = !disabledAgents.some(
        (agent) => agent.toLowerCase() === "multimodal-looker"
      )
      expect(isEnabled).toBe(false)
    })

    // given multimodal-looker is NOT in disabled_agents
    // when checking if agent is enabled
    // then should return true (enabled)
    it("returns true when multimodal-looker is not disabled", () => {
      const disabledAgents: string[] = ["oracle", "librarian"]
      const isEnabled = !disabledAgents.some(
        (agent) => agent.toLowerCase() === "multimodal-looker"
      )
      expect(isEnabled).toBe(true)
    })

    // given disabled_agents is empty
    // when checking if agent is enabled
    // then should return true (enabled by default)
    it("returns true when disabled_agents is empty", () => {
      const disabledAgents: string[] = []
      const isEnabled = !disabledAgents.some(
        (agent) => agent.toLowerCase() === "multimodal-looker"
      )
      expect(isEnabled).toBe(true)
    })

    // given disabled_agents is undefined (simulated as empty array)
    // when checking if agent is enabled
    // then should return true (enabled by default)
    it("returns true when disabled_agents is undefined (fallback to empty)", () => {
      const disabledAgents: string[] | undefined = undefined
      const list: string[] = disabledAgents ?? []
      const isEnabled = !list.some(
        (agent) => agent.toLowerCase() === "multimodal-looker"
      )
      expect(isEnabled).toBe(true)
    })
  })

  describe("conditional tool spread pattern", () => {
    // given lookAt is not null (agent enabled)
    // when spreading into tool object
    // then look_at should be included
    it("includes look_at when lookAt is not null", () => {
      const lookAt = { execute: () => {} } // mock tool
      const tools = {
        ...(lookAt ? { look_at: lookAt } : {}),
      }
      expect(tools).toHaveProperty("look_at")
    })

    // given lookAt is null (agent disabled)
    // when spreading into tool object
    // then look_at should NOT be included
    it("excludes look_at when lookAt is null", () => {
      const lookAt = null
      const tools = {
        ...(lookAt ? { look_at: lookAt } : {}),
      }
      expect(tools).not.toHaveProperty("look_at")
    })
  })
})

const mockInitConfigContext = mock(() => {})
const mockDetectExternalSkillPlugin = mock(() => ({ detected: false, pluginName: null }))
const mockGetSkillPluginConflictWarning = mock(() => "")
const mockInjectServerAuthIntoClient = mock(() => {})
const mockLogLegacyPluginStartupWarning = mock(() => {})
const mockLoadPluginConfig = mock(() => ({}))
const mockIsTmuxIntegrationEnabled = mock(
  (pluginConfig: { tmux?: { enabled?: boolean } | undefined }) => pluginConfig.tmux?.enabled ?? false,
)
const mockIsInteractiveBashEnabled = mock(() => false)
const mockCreateRuntimeTmuxConfig = mock(() => ({
  enabled: false,
  layout: "tiled" as const,
  main_pane_size: 60,
  main_pane_min_width: 80,
  agent_pane_min_width: 40,
  isolation: "inline" as const,
}))
const mockCreateManagers = mock(() => ({
  backgroundManager: { shutdown: async () => {} },
  skillMcpManager: { disconnectAll: async () => {} },
  configHandler: async () => {},
}))
const mockCreateTools = mock(async () => ({
  mergedSkills: [],
  availableSkills: [],
  filteredTools: {},
}))
const mockCreateHooks = mock(() => ({
  disposeHooks: () => {},
  compactionContextInjector: undefined,
  compactionTodoPreserver: undefined,
  claudeCodeHooks: undefined,
}))
const mockCreatePluginDispose = mock(() => async () => {})
const mockCreatePluginInterface = mock(() => ({}))
const mockInitializeOpenClaw = mock(async () => {})
const mockStartTmuxCheck = mock(() => {})

mock.module("./cli/config-manager/config-context", () => ({
  initConfigContext: mockInitConfigContext,
}))

mock.module("./shared/external-plugin-detector", () => ({
  detectExternalSkillPlugin: mockDetectExternalSkillPlugin,
  getSkillPluginConflictWarning: mockGetSkillPluginConflictWarning,
}))

mock.module("./shared", () => ({
  injectServerAuthIntoClient: mockInjectServerAuthIntoClient,
  log: mock(() => {}),
  logLegacyPluginStartupWarning: mockLogLegacyPluginStartupWarning,
}))

mock.module("./plugin-config", () => ({
  loadPluginConfig: mockLoadPluginConfig,
}))

mock.module("./create-runtime-tmux-config", () => ({
  createRuntimeTmuxConfig: mockCreateRuntimeTmuxConfig,
  isTmuxIntegrationEnabled: mockIsTmuxIntegrationEnabled,
  isInteractiveBashEnabled: mockIsInteractiveBashEnabled,
}))

mock.module("./create-managers", () => ({
  createManagers: mockCreateManagers,
}))

mock.module("./create-tools", () => ({
  createTools: mockCreateTools,
}))

mock.module("./create-hooks", () => ({
  createHooks: mockCreateHooks,
}))

mock.module("./plugin-dispose", () => ({
  createPluginDispose: mockCreatePluginDispose,
}))

mock.module("./plugin-interface", () => ({
  createPluginInterface: mockCreatePluginInterface,
}))

mock.module("./plugin-state", () => ({
  createModelCacheState: mock(() => ({})),
}))

mock.module("./shared/first-message-variant", () => ({
  createFirstMessageVariantGate: mock(() => ({
    shouldOverride: () => false,
    markApplied: () => {},
    markSessionCreated: () => {},
    clear: () => {},
  })),
}))

mock.module("./openclaw", () => ({
  initializeOpenClaw: mockInitializeOpenClaw,
}))

mock.module("./tools/interactive-bash", () => ({
  interactive_bash: {},
  startBackgroundCheck: mockStartTmuxCheck,
}))

mock.module("./tools/lsp/client", () => ({
  lspManager: {
    cleanupTempDirectoryClients: async () => {},
  },
}))

const { default: OhMyOpenCodePlugin } = await import("./index")

describe("OhMyOpenCodePlugin", () => {
  beforeEach(() => {
    mockInitConfigContext.mockClear()
    mockDetectExternalSkillPlugin.mockClear()
    mockGetSkillPluginConflictWarning.mockClear()
    mockInjectServerAuthIntoClient.mockClear()
    mockLogLegacyPluginStartupWarning.mockClear()
    mockLoadPluginConfig.mockClear()
    mockIsTmuxIntegrationEnabled.mockClear()
    mockIsInteractiveBashEnabled.mockClear()
    mockCreateRuntimeTmuxConfig.mockClear()
    mockCreateManagers.mockClear()
    mockCreateTools.mockClear()
    mockCreateHooks.mockClear()
    mockCreatePluginDispose.mockClear()
    mockCreatePluginInterface.mockClear()
    mockInitializeOpenClaw.mockClear()
    mockStartTmuxCheck.mockClear()
  })

  afterAll(() => {
    mock.restore()
  })

  it("starts openclaw during plugin bootstrap when openclaw config exists", async () => {
    // given
    const openclawConfig = {
      enabled: true,
      gateways: {},
      hooks: {},
      replyListener: {
        discordBotToken: "discord-token",
      },
    }
    mockLoadPluginConfig.mockReturnValue({
      openclaw: openclawConfig,
    })

    // when
    await OhMyOpenCodePlugin({
      directory: "/tmp/project",
      client: {},
    } as Parameters<typeof OhMyOpenCodePlugin>[0])

    // then
    expect(mockInitializeOpenClaw).toHaveBeenCalledTimes(1)
    expect(mockInitializeOpenClaw).toHaveBeenCalledWith(openclawConfig)
  })

  it("does not start openclaw when openclaw config is absent", async () => {
    // given
    mockLoadPluginConfig.mockReturnValue({})

    // when
    await OhMyOpenCodePlugin({
      directory: "/tmp/project",
      client: {},
    } as Parameters<typeof OhMyOpenCodePlugin>[0])

    // then
    expect(mockInitializeOpenClaw).not.toHaveBeenCalled()
  })
})
