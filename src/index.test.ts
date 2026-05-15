import { beforeEach, describe, expect, it, mock } from "bun:test"
import { createPluginModule } from "./index"

const mockInitConfigContext = mock(() => {})
const mockDetectExternalSkillPlugin = mock(() => ({ detected: false, pluginName: null }))
const mockGetSkillPluginConflictWarning = mock(() => "")
const mockInjectServerAuthIntoClient = mock(() => {})
const mockLogLegacyPluginStartupWarning = mock(() => {})
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

  it("exports a V1 PluginModule shape with id and server", () => {
    // given the plugin module is loaded
    // when inspecting the default export
    // then it has the expected V1 shape
    expect(typeof pluginModule).toBe("object")
    expect(pluginModule.id).toBe("oh-my-openagent")
    expect(typeof pluginModule.server).toBe("function")
  })

  // Regression test for issue #3893: fresh installs with
  // `team_mode.enabled: true` had no observable signal that the config was
  // picked up. Plugin must emit both a stderr-visible console.warn and an
  // internal log entry on successful team-mode init.
  it("emits a user-visible signal when team_mode is enabled on a fresh install", async () => {
    // given a fresh-install config that only opts into team_mode
    const teamModeConfig = {
      enabled: true,
      tmux_visualization: false,
      max_parallel_members: 4,
      max_members: 8,
      max_messages_per_run: 10000,
      max_wall_clock_minutes: 120,
      max_member_turns: 500,
      message_payload_max_bytes: 32768,
      recipient_unread_max_bytes: 262144,
      mailbox_poll_interval_ms: 3000,
    }
    mockLoadPluginConfig.mockReturnValue({ team_mode: teamModeConfig })
    const consoleWarn = mock(() => {})
    const originalConsoleWarn = console.warn
    console.warn = consoleWarn as unknown as typeof console.warn

    // when the plugin boots
    try {
      await pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0])
    } finally {
      console.warn = originalConsoleWarn
    }

    // then a stderr-visible "[team-mode] enabled" message is emitted so the
    // user can verify the config landed (issue #3893).
    const warnCalls = consoleWarn.mock.calls.map((call) => String(call[0] ?? ""))
    const enabledWarn = warnCalls.find((message) => message.startsWith("[team-mode] enabled"))
    expect(enabledWarn).toBeDefined()
    expect(enabledWarn).toContain("base_dir=")

    // and the internal log records the enabled state for diagnostics.
    const logCalls = mockLog.mock.calls.map((call) => String(call[0] ?? ""))
    expect(logCalls).toContain("[team-mode] enabled")
  })
})
