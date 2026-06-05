import { beforeEach, describe, expect, it, mock } from "bun:test"
import { getLocale, initI18n, t } from "../shared/i18n"
import { PROCESS_LISTENERS_CAP_DEFAULT } from "../shared/raise-process-listeners-cap"
import { createPluginModule } from "./create-plugin-module"

const mockInitConfigContext = mock(() => {})
const mockDetectExternalSkillPlugin = mock(() => ({ detected: false, pluginName: null, allPlugins: [] }))
const mockGetSkillPluginConflictWarning = mock(() => "")
const mockInjectServerAuthIntoClient = mock(() => {})
const mockLogLegacyPluginStartupWarning = mock(() => {})
const mockMigrateLegacyWorkspaceDirectory = mock(() => ({ migrated: false, skipped: [] }))
const mockRaiseProcessListenersCap = mock(() => {})
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

function createTestPluginModule(): ReturnType<typeof createPluginModule> {
  return createPluginModule({
    initConfigContext: mockInitConfigContext,
    detectExternalSkillPlugin: mockDetectExternalSkillPlugin,
    getSkillPluginConflictWarning: mockGetSkillPluginConflictWarning,
    injectServerAuthIntoClient: mockInjectServerAuthIntoClient,
    logLegacyPluginStartupWarning: mockLogLegacyPluginStartupWarning,
    migrateLegacyWorkspaceDirectory: mockMigrateLegacyWorkspaceDirectory,
    raiseProcessListenersCap: mockRaiseProcessListenersCap,
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

describe("createPluginModule()", () => {
  beforeEach(() => {
    mockLoadPluginConfig.mockClear()
    initI18n({ locale: "en", fallback: "en" })
  })

  describe("#given plugin config sets i18n.locale to zh", () => {
    it("#then production startup applies the configured locale", async () => {
      // given
      const pluginModule = createTestPluginModule()
      mockLoadPluginConfig.mockReturnValue({
        i18n: { locale: "zh" },
      })

      // when
      await pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0])

      // then
      expect(getLocale()).toBe("zh")
      expect(t("toast.task_completed")).toBe("任务完成")
    })
  })

  describe("#given the plugin server starts (#4334)", () => {
    it("#when startup runs #then the listener cap is raised before any listener-registering work", async () => {
      // given
      mockRaiseProcessListenersCap.mockClear()
      mockCreateManagers.mockClear()
      mockCreateTools.mockClear()
      mockCreateHooks.mockClear()
      mockStartTmuxCheck.mockClear()
      mockLoadPluginConfig.mockReturnValue({ tmux: { enabled: true } })
      const pluginModule = createTestPluginModule()

      // when
      await pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0])

      // then - raised exactly once with the default cap
      expect(mockRaiseProcessListenersCap).toHaveBeenCalledTimes(1)
      expect(mockRaiseProcessListenersCap).toHaveBeenCalledWith(PROCESS_LISTENERS_CAP_DEFAULT)

      // then - and raised before anything that registers process listeners
      const raisedAt = mockRaiseProcessListenersCap.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
      const listenerRegistrars = [
        mockStartTmuxCheck.mock.invocationCallOrder[0],
        mockCreateManagers.mock.invocationCallOrder[0],
        mockCreateTools.mock.invocationCallOrder[0],
        mockCreateHooks.mock.invocationCallOrder[0],
      ]
      for (const registeredAt of listenerRegistrars) {
        expect(registeredAt).toBeDefined()
        expect(raisedAt).toBeLessThan(registeredAt ?? Number.MIN_SAFE_INTEGER)
      }
    })
  })
})
