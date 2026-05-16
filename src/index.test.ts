import { beforeEach, describe, expect, it, mock } from "bun:test"
import { createPluginModule } from "./testing/create-plugin-module"

const mockInitConfigContext = mock(() => {})
const mockDetectExternalSkillPlugin = mock(() => ({ detected: false, pluginName: null }))
const mockGetSkillPluginConflictWarning = mock(() => "")
const mockInjectServerAuthIntoClient = mock(() => {})
const mockLogLegacyPluginStartupWarning = mock(() => {})
const mockMigrateLegacyWorkspaceDirectory = mock(() => ({ migrated: false, skipped: [] }))
const mockLoadPluginConfig = mock(() => ({}))
const mockIsTmuxIntegrationEnabled = mock(
  (pluginConfig: { tmux?: { enabled?: boolean } | undefined }) => pluginConfig.tmux?.enabled ?? false,
)
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
const mockInstallAgentSortShim = mock(() => {})
const mockSetAgentSortOrder = mock(() => {})
const mockLog = mock(() => {})
const mockCreateModelCacheState = mock(() => ({}))
const mockCreateFirstMessageVariantGate = mock(() => ({
  shouldOverride: () => false,
  markApplied: () => {},
  markSessionCreated: () => {},
  clear: () => {},
}))

let pluginModule: ReturnType<typeof createPluginModule>

function createTestPluginModule(): ReturnType<typeof createPluginModule> {
  return createPluginModule({
    initConfigContext: mockInitConfigContext,
    detectExternalSkillPlugin: mockDetectExternalSkillPlugin,
    getSkillPluginConflictWarning: mockGetSkillPluginConflictWarning,
    injectServerAuthIntoClient: mockInjectServerAuthIntoClient,
    logLegacyPluginStartupWarning: mockLogLegacyPluginStartupWarning,
    migrateLegacyWorkspaceDirectory: mockMigrateLegacyWorkspaceDirectory,
    loadPluginConfig: mockLoadPluginConfig as never,
    isTmuxIntegrationEnabled: mockIsTmuxIntegrationEnabled as never,
    createRuntimeTmuxConfig: mockCreateRuntimeTmuxConfig as never,
    createManagers: mockCreateManagers as never,
    createTools: mockCreateTools as never,
    createHooks: mockCreateHooks as never,
    createPluginInterface: mockCreatePluginInterface as never,
    initializeOpenClaw: mockInitializeOpenClaw as never,
    startTmuxCheck: mockStartTmuxCheck,
    installAgentSortShim: mockInstallAgentSortShim,
    setAgentSortOrder: mockSetAgentSortOrder,
    log: mockLog,
    createModelCacheState: mockCreateModelCacheState as never,
    createFirstMessageVariantGate: mockCreateFirstMessageVariantGate as never,
  })
}

describe("oh-my-openagent plugin module", () => {
  beforeEach(() => {
    mockInitConfigContext.mockClear()
    mockDetectExternalSkillPlugin.mockClear()
    mockGetSkillPluginConflictWarning.mockClear()
    mockInjectServerAuthIntoClient.mockClear()
    mockLogLegacyPluginStartupWarning.mockClear()
    mockMigrateLegacyWorkspaceDirectory.mockClear()
    mockLoadPluginConfig.mockClear()
    mockIsTmuxIntegrationEnabled.mockClear()
    mockCreateRuntimeTmuxConfig.mockClear()
    mockCreateManagers.mockClear()
    mockCreateTools.mockClear()
    mockCreateHooks.mockClear()
    mockCreatePluginInterface.mockClear()
    mockInitializeOpenClaw.mockClear()
    mockStartTmuxCheck.mockClear()
    mockInstallAgentSortShim.mockClear()
    mockSetAgentSortOrder.mockClear()
    mockLog.mockClear()
    mockCreateModelCacheState.mockClear()
    mockCreateFirstMessageVariantGate.mockClear()
    pluginModule = createTestPluginModule()
  })

  it("starts openclaw during plugin bootstrap when openclaw config exists", async () => {
    // given
    const openclawConfig = {
      enabled: true,
      gateways: {},
      hooks: {},
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
  }, { timeout: 15000 })

  it("migrates legacy workspace state during plugin bootstrap", async () => {
    // given
    const directory = "/tmp/project"
    mockLoadPluginConfig.mockReturnValue({})

    // when
    await pluginModule.server({
      directory,
      client: {},
    } as Parameters<typeof pluginModule.server>[0])

    // then
    expect(mockMigrateLegacyWorkspaceDirectory).toHaveBeenCalledTimes(1)
    expect(mockMigrateLegacyWorkspaceDirectory).toHaveBeenCalledWith(directory)
    expect(mockMigrateLegacyWorkspaceDirectory.mock.invocationCallOrder[0]).toBeLessThan(
      mockLoadPluginConfig.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
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
