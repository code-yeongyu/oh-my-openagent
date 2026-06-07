import { beforeEach, describe, expect, it, mock } from "bun:test"
import { getLocale, initI18n, t } from "../shared/i18n"
import { createPluginModule } from "./create-plugin-module"

const sourcePlugin = new URL("../index.ts", import.meta.url).href

const mockInitConfigContext = mock(() => {})
const mockDetectExternalSkillPlugin = mock(() => ({ detected: false, pluginName: null, allPlugins: [] }))
const mockGetSkillPluginConflictWarning = mock(() => "")
const mockDetectDuplicateOmoPlugin = mock(() => ({
  detected: false,
  pluginName: null,
  duplicatePlugins: [],
  allPlugins: [],
}))
const mockGetDuplicateOmoPluginWarning = mock(() => "")
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
const mockRuntimeSkillSourceStop = mock(() => {})
const mockCreateRuntimeSkillSourceServer = mock(
  (options: { readonly skills: readonly { readonly name: string }[] }) => ({
    url: `http://127.0.0.1:49152/${options.skills.map((skill) => skill.name).join(",")}`,
    stop: mockRuntimeSkillSourceStop,
  }),
)
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
    detectDuplicateOmoPlugin: mockDetectDuplicateOmoPlugin,
    getDuplicateOmoPluginWarning: mockGetDuplicateOmoPluginWarning,
    injectServerAuthIntoClient: mockInjectServerAuthIntoClient,
    logLegacyPluginStartupWarning: mockLogLegacyPluginStartupWarning,
    migrateLegacyWorkspaceDirectory: mockMigrateLegacyWorkspaceDirectory,
    loadPluginConfig: mockLoadPluginConfig as never,
    isTmuxIntegrationEnabled: mockIsTmuxIntegrationEnabled as never,
    createRuntimeTmuxConfig: mockCreateRuntimeTmuxConfig as never,
    createManagers: mockCreateManagers as never,
    createRuntimeSkillSourceServer: mockCreateRuntimeSkillSourceServer as never,
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
    mockDetectDuplicateOmoPlugin.mockClear()
    mockGetDuplicateOmoPluginWarning.mockClear()
    mockInjectServerAuthIntoClient.mockClear()
    mockLoadPluginConfig.mockClear()
    mockCreateManagers.mockClear()
    mockRuntimeSkillSourceStop.mockClear()
    mockCreateRuntimeSkillSourceServer.mockClear()
    mockCreateTools.mockClear()
    mockCreateHooks.mockClear()
    mockCreatePluginInterface.mockClear()
    mockDetectDuplicateOmoPlugin.mockReturnValue({
      detected: false,
      pluginName: null,
      duplicatePlugins: [],
      allPlugins: [],
    })
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

  describe("#given bundled security skills are enabled", () => {
    it("#then startup exposes them through a runtime skill source URL", async () => {
      // given
      const pluginModule = createTestPluginModule()
      mockLoadPluginConfig.mockReturnValue({})

      // when
      await pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0])

      // then
      const sourceArgs = mockCreateRuntimeSkillSourceServer.mock.calls.at(0)?.[0]
      expect(sourceArgs?.skills.map((skill) => skill.name)).toEqual([
        "security-research",
        "security-review",
      ])
      expect(mockCreateManagers.mock.calls.at(0)?.[0]).toMatchObject({
        runtimeSkillSourceUrl: "http://127.0.0.1:49152/security-research,security-review",
      })
    })

    it("#given the runtime skill source server is unavailable #then startup continues without a source URL", async () => {
      // given
      const pluginModule = createTestPluginModule()
      const consoleWarn = mock(() => {})
      const originalWarn = console.warn
      console.warn = consoleWarn
      mockLoadPluginConfig.mockReturnValue({})
      mockCreateRuntimeSkillSourceServer.mockImplementationOnce(() => {
        throw new Error("Runtime skill source server requires Bun.serve")
      })

      try {
        // when
        await pluginModule.server({
          directory: "/tmp/project",
          client: {},
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(mockCreateManagers.mock.calls.at(0)?.[0]?.runtimeSkillSourceUrl).toBeUndefined()
        expect(mockCreateTools).toHaveBeenCalledTimes(1)
        expect(mockCreatePluginInterface).toHaveBeenCalledTimes(1)
        expect(consoleWarn).toHaveBeenCalledWith(
          "[runtime-skills] bundled security skill source unavailable; continuing without config.skills.urls: Runtime skill source server requires Bun.serve",
        )
      } finally {
        console.warn = originalWarn
      }
    })

    it("#then dispose stops the runtime skill source", async () => {
      // given
      const pluginModule = createTestPluginModule()
      mockLoadPluginConfig.mockReturnValue({})

      // when
      const hooks: Awaited<ReturnType<typeof pluginModule.server>> & {
        dispose?: () => Promise<void>
      } = await pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0])
      await hooks.dispose?.()

      // then
      expect(mockRuntimeSkillSourceStop).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given security-research is disabled", () => {
    it("#then startup still exposes security-review through the runtime skill source", async () => {
      // given
      const pluginModule = createTestPluginModule()
      mockLoadPluginConfig.mockReturnValue({
        disabled_skills: ["security-research"],
      })

      // when
      await pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0])

      // then
      const sourceArgs = mockCreateRuntimeSkillSourceServer.mock.calls.at(0)?.[0]
      expect(sourceArgs?.skills.map((skill) => skill.name)).toEqual(["security-review"])
      expect(mockCreateManagers.mock.calls.at(0)?.[0]).toMatchObject({
        runtimeSkillSourceUrl: "http://127.0.0.1:49152/security-review",
      })
    })
  })

  describe("#given duplicate OMO plugin entries are configured", () => {
    it("#then startup warns and returns no prompt-producing hooks", async () => {
      // given
      const pluginModule = createTestPluginModule()
      const duplicatePlugins = [
        sourcePlugin,
        "oh-my-openagent@latest",
      ]
      mockDetectDuplicateOmoPlugin.mockReturnValue({
        detected: true,
        pluginName: "oh-my-openagent",
        duplicatePlugins,
        allPlugins: duplicatePlugins,
      })
      mockGetDuplicateOmoPluginWarning.mockReturnValue("duplicate OMO startup disabled")
      const consoleWarn = mock(() => {})
      const originalWarn = console.warn
      console.warn = consoleWarn

      try {
        // when
        const hooks = await pluginModule.server({
          directory: "/tmp/project",
          client: {},
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(hooks).toEqual({})
        expect(consoleWarn).toHaveBeenCalledWith("duplicate OMO startup disabled")
        expect(mockInjectServerAuthIntoClient).not.toHaveBeenCalled()
        expect(mockCreateManagers).not.toHaveBeenCalled()
        expect(mockCreateTools).not.toHaveBeenCalled()
        expect(mockCreateHooks).not.toHaveBeenCalled()
        expect(mockCreatePluginInterface).not.toHaveBeenCalled()
      } finally {
        console.warn = originalWarn
      }
    })
  })
})
