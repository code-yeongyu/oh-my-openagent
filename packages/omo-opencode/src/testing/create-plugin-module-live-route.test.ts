import { beforeEach, describe, expect, it, mock } from "bun:test"
import { createPluginModule } from "./create-plugin-module"

const mockInitConfigContext = mock(() => {})
const mockDetectExternalSkillPlugin = mock(() => ({ detected: false, pluginName: null, allPlugins: [] }))
const mockGetSkillPluginConflictWarning = mock(() => "")
const mockDetectDuplicateOmoPlugin = mock(
  (): { detected: boolean; pluginName: string | null; duplicatePlugins: string[]; allPlugins: string[] } => ({
    detected: false,
    pluginName: null,
    duplicatePlugins: [],
    allPlugins: [],
  }),
)
const mockGetDuplicateOmoPluginWarning = mock(() => "")
const mockInjectServerAuthIntoClient = mock(() => {})
const mockLogLegacyPluginStartupWarning = mock(() => {})
const mockMigrateLegacyWorkspaceDirectory = mock(() => ({ migrated: false, skipped: [] }))
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
const mockCreateRuntimeSkillSourceServer = mock(
  (options: { readonly skills: readonly { readonly name: string }[] }) => ({
    url: `http://127.0.0.1:49152/${options.skills.map((skill) => skill.name).join(",")}`,
    stop: mock(() => {}),
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

type InitLiveServerRouteOpts = {
  serverUrl: URL | undefined
  directory: string
  inProcessClient: unknown
}

function createTestPluginModule(
  overrides: {
    loadPluginConfig?: ReturnType<typeof mock>
    initLiveServerRoute?: ReturnType<typeof mock>
    setLiveParentWakeRoutingDisabled?: ReturnType<typeof mock>
    warmLiveServerProbe?: ReturnType<typeof mock>
  } = {},
): ReturnType<typeof createPluginModule> {
  const {
    loadPluginConfig: loadPluginConfigOverride,
    initLiveServerRoute,
    setLiveParentWakeRoutingDisabled,
    warmLiveServerProbe,
  } = overrides

  const mockLoadPluginConfig = loadPluginConfigOverride ?? mock(() => ({}))

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
    ...(initLiveServerRoute !== undefined ? { initLiveServerRoute } : {}),
    ...(setLiveParentWakeRoutingDisabled !== undefined ? { setLiveParentWakeRoutingDisabled } : {}),
    ...(warmLiveServerProbe !== undefined ? { warmLiveServerProbe } : {}),
  })
}

describe("createPluginModule() — live-server-route wiring", () => {
  beforeEach(() => {
    mockDetectDuplicateOmoPlugin.mockClear()
    mockGetDuplicateOmoPluginWarning.mockClear()
    mockInjectServerAuthIntoClient.mockClear()
    mockCreateManagers.mockClear()
    mockCreateTools.mockClear()
    mockCreateHooks.mockClear()
    mockCreatePluginInterface.mockClear()
    mockDetectDuplicateOmoPlugin.mockReturnValue({
      detected: false,
      pluginName: null,
      duplicatePlugins: [],
      allPlugins: [],
    })
  })

  describe("#given a never-resolving probe fetch injected via warmLiveServerProbe dep", () => {
    it("#when server(input) is called #then it resolves in under 3s and returns hooks (fire-and-forget / 409-readiness)", async () => {
      //#given
      const neverResolving = mock(async () => {
        await new Promise<never>(() => {})
      }) as ReturnType<typeof mock>
      const pluginModule = createTestPluginModule({ warmLiveServerProbe: neverResolving })

      const input = {
        directory: "/tmp/live-route-test",
        client: {},
        serverUrl: new URL("http://127.0.0.1:1"),
      } as Parameters<typeof pluginModule.server>[0]

      //#when
      const start = Date.now()
      const result = await pluginModule.server(input, {})
      const elapsed = Date.now() - start

      //#then
      expect(elapsed).toBeLessThan(3000)
      expect(result).toBeDefined()
    })
  })

  describe("#given standard plugin input with serverUrl and client", () => {
    it("#when server(input) completes #then initLiveServerRoute received inProcessClient === input.client (reference equality)", async () => {
      //#given
      const capturedOpts: InitLiveServerRouteOpts[] = []
      const mockInitLiveServerRoute = mock((opts: InitLiveServerRouteOpts) => {
        capturedOpts.push(opts)
      })

      const pluginModule = createTestPluginModule({ initLiveServerRoute: mockInitLiveServerRoute })
      const client = {}
      const serverUrl = new URL("http://127.0.0.1:4000")

      const input = {
        directory: "/tmp/live-route-wiring-test",
        client,
        serverUrl,
      } as Parameters<typeof pluginModule.server>[0]

      //#when
      await pluginModule.server(input, {})

      //#then
      expect(capturedOpts).toHaveLength(1)
      expect(capturedOpts[0]?.inProcessClient).toBe(client)
      expect(capturedOpts[0]?.serverUrl).toBe(serverUrl)
      expect(capturedOpts[0]?.directory).toBe("/tmp/live-route-wiring-test")
    })
  })

  describe("#given config with experimental.disable_live_parent_wake_routing: true", () => {
    it("#when server(input) completes #then setLiveParentWakeRoutingDisabled(true) is called", async () => {
      //#given
      const calls: boolean[] = []
      const mockSetDisabled = mock((v: boolean) => {
        calls.push(v)
      })
      const mockLoadPluginConfig = mock(() => ({
        experimental: { disable_live_parent_wake_routing: true },
      }))

      const pluginModule = createTestPluginModule({
        loadPluginConfig: mockLoadPluginConfig,
        setLiveParentWakeRoutingDisabled: mockSetDisabled,
      })

      //#when
      await pluginModule.server({
        directory: "/tmp/live-flag-test",
        client: {},
        serverUrl: new URL("http://127.0.0.1:4000"),
      } as Parameters<typeof pluginModule.server>[0])

      //#then
      expect(calls).toHaveLength(1)
      expect(calls[0]).toBe(true)
    })
  })

  describe("#given config without experimental block", () => {
    it("#when server(input) completes #then setLiveParentWakeRoutingDisabled(false) is called", async () => {
      //#given
      const calls: boolean[] = []
      const mockSetDisabled = mock((v: boolean) => {
        calls.push(v)
      })
      const mockLoadPluginConfig = mock(() => ({}))

      const pluginModule = createTestPluginModule({
        loadPluginConfig: mockLoadPluginConfig,
        setLiveParentWakeRoutingDisabled: mockSetDisabled,
      })

      //#when
      await pluginModule.server({
        directory: "/tmp/live-flag-absent-test",
        client: {},
        serverUrl: new URL("http://127.0.0.1:4000"),
      } as Parameters<typeof pluginModule.server>[0])

      //#then
      expect(calls).toHaveLength(1)
      expect(calls[0]).toBe(false)
    })
  })

  describe("#given duplicate OMO plugin detected", () => {
    it("#when server(input) early-returns #then initLiveServerRoute is not called", async () => {
      //#given
      const mockInitLiveServerRoute = mock(() => {})
      mockDetectDuplicateOmoPlugin.mockReturnValue({
        detected: true,
        pluginName: "oh-my-openagent",
        duplicatePlugins: ["oh-my-openagent@latest"],
        allPlugins: ["oh-my-openagent@latest"],
      })
      mockGetDuplicateOmoPluginWarning.mockReturnValue("duplicate detected")
      const consoleWarn = mock(() => {})
      const originalWarn = console.warn
      console.warn = consoleWarn

      try {
        const pluginModule = createTestPluginModule({ initLiveServerRoute: mockInitLiveServerRoute })

        //#when
        const hooks = await pluginModule.server({
          directory: "/tmp/live-dup-test",
          client: {},
        } as Parameters<typeof pluginModule.server>[0])

        //#then
        expect(hooks).toEqual({})
        expect(mockInitLiveServerRoute).not.toHaveBeenCalled()
      } finally {
        console.warn = originalWarn
      }
    })
  })
})
