import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

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
const mockCreatePluginInterface = mock(() => ({}))
const mockInitializeOpenClaw = mock(async () => {})
const mockStartTmuxCheck = mock(() => {})

let pluginModule: (typeof import("./index"))["default"]

function installIndexModuleMocks(): void {
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

}

async function importFreshIndexModule(): Promise<typeof import("./index")> {
  return import(`./index?test=${Date.now()}-${Math.random()}`)
}

describe("OhMyOpenCodePlugin", () => {
  beforeEach(async () => {
    mock.restore()
    installIndexModuleMocks()
    ;({ default: pluginModule } = await importFreshIndexModule())
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
    mockCreatePluginInterface.mockClear()
    mockInitializeOpenClaw.mockClear()
    mockStartTmuxCheck.mockClear()
  })

  afterEach(() => {
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
    await pluginModule.server({
      directory: "/tmp/project",
      client: {},
    } as Parameters<typeof pluginModule.server>[0])

    // then
    expect(mockInitializeOpenClaw).toHaveBeenCalledTimes(1)
    expect(mockInitializeOpenClaw).toHaveBeenCalledWith(openclawConfig)
  })

  it("does not start openclaw when openclaw config is absent", async () => {
    // given
    mockLoadPluginConfig.mockReturnValue({})

    // when
    await pluginModule.server({
      directory: "/tmp/project",
      client: {},
    } as Parameters<typeof pluginModule.server>[0])

    // then
    expect(mockInitializeOpenClaw).not.toHaveBeenCalled()
  })

  it("exports a V1 PluginModule shape with id and server", () => {
    // given the plugin module is loaded
    // when inspecting the default export
    // then it has the expected V1 shape
    expect(typeof pluginModule).toBe("object")
    expect(pluginModule.id).toBe("oh-my-openagent")
    expect(typeof pluginModule.server).toBe("function")
  })
})
