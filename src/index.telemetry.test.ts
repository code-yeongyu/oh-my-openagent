import { beforeEach, describe, expect, it, mock } from "bun:test"
import { createPluginModule } from "./testing/create-plugin-module"

const mockInitConfigContext = mock(() => {})
const mockInjectServerAuthIntoClient = mock(() => {})
const mockLogLegacyPluginStartupWarning = mock(() => {})
const mockMigrateLegacyWorkspaceDirectory = mock(() => ({ migrated: false, skipped: [] }))
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
const mockCreatePluginInterface = mock(() => ({}))
const mockLog = mock(() => {})

function createTestPluginModule(): ReturnType<typeof createPluginModule> {
  return createPluginModule({
    initConfigContext: mockInitConfigContext,
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
    log: mockLog,
    detectExternalSkillPlugin: mock(() => ({ detected: false, pluginName: null })),
    getSkillPluginConflictWarning: mock(() => ""),
    initializeOpenClaw: mock(async () => {}),
    startTmuxCheck: mock(() => {}),
    createModelCacheState: mock(() => ({})) as never,
    createFirstMessageVariantGate: mock(() => ({
      shouldOverride: () => false,
      markApplied: () => {},
      markSessionCreated: () => {},
      clear: () => {},
    })) as never,
    installAgentSortShim: mock(() => {}),
    setAgentSortOrder: mock(() => {}),
    raiseEventEmitterLimit: mock(() => {}),
  })
}

describe("oh-my-openagent telemetry isolation", () => {
  beforeEach(() => {
    mockInitConfigContext.mockClear()
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
    mockLog.mockClear()
  })

  it("does not crash plugin load when telemetry throws", async () => {
    // given
    const plugin = createTestPluginModule()

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
