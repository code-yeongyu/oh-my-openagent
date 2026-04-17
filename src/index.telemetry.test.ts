import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

const mockInitConfigContext = mock(() => {})
const mockInjectServerAuthIntoClient = mock(() => {})
const mockLogLegacyPluginStartupWarning = mock(() => {})
const mockLoadPluginConfig = mock(() => ({}))
const mockIsTmuxIntegrationEnabled = mock(() => false)
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
const mockCreatePluginPostHog = mock(() => ({
  trackActive: () => {
    throw new Error("telemetry failed")
  },
  capture: mock(() => {}),
  captureException: mock(() => {}),
  shutdown: mock(async () => {}),
}))
const mockGetPostHogDistinctId = mock(() => "plugin-distinct-id")

function installModuleMocks(): void {
  mock.module("./cli/config-manager/config-context", () => ({
    initConfigContext: mockInitConfigContext,
  }))
  mock.module("./shared/external-plugin-detector", () => ({
    detectExternalSkillPlugin: mock(() => ({ detected: false, pluginName: null })),
    getSkillPluginConflictWarning: mock(() => ""),
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
    initializeOpenClaw: mock(async () => {}),
  }))
  mock.module("./tools/interactive-bash", () => ({
    interactive_bash: {},
    startBackgroundCheck: mock(() => {}),
  }))
  mock.module("./tools/lsp/client", () => ({
    lspManager: {
      getClient: mock(async () => ({
        diagnostics: mock(async () => ({ items: [] })),
      })),
      stopAll: mock(async () => {}),
      releaseClient: mock(() => {}),
      cleanupTempDirectoryClients: mock(async () => {}),
    },
  }))
  mock.module("./shared/posthog", () => ({
    createPluginPostHog: mockCreatePluginPostHog,
    getPostHogDistinctId: mockGetPostHogDistinctId,
  }))
}

describe("OhMyOpenCodePlugin telemetry isolation", () => {
  beforeEach(() => {
    mock.restore()
    installModuleMocks()
  })

  afterEach(() => {
    mock.restore()
  })

  it("does not crash plugin load when telemetry throws", async () => {
    // given
    const { default: plugin } = await import(`./index?telemetry=${Date.now()}-${Math.random()}`)

    // when
    const result = await plugin.server({
      directory: "/tmp/project",
      client: {},
    } as Parameters<typeof plugin.server>[0])

    // then
    expect(typeof result).toBe("object")
    expect(result).not.toBeNull()
  })
})
