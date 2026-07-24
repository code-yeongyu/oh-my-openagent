import { beforeEach, describe, expect, it, mock } from "bun:test"
import { createPluginModule } from "./testing/create-plugin-module"

const mockCreateTools = mock(async () => {
  throw new Error("createTools failed")
})
const mockInitializeOpenClaw = mock(async () => true)
const mockStopReplyListener = mock(async () => ({ success: true, message: "stopped" }))
const mockLog = mock(() => {})

function createTestPluginModule(): ReturnType<typeof createPluginModule> {
  return createPluginModule({
    initConfigContext: mock(() => {}),
    installAgentSortShim: mock(() => {}),
    setAgentSortOrder: mock(() => {}),
    log: mockLog,
    logLegacyPluginStartupWarning: mock(() => {}),
    migrateLegacyWorkspaceDirectory: mock(() => ({ migrated: false, skipped: [] })),
    detectDuplicateOmoPlugin: mock(() => ({
      detected: false,
      pluginName: null,
      duplicatePlugins: [],
      allPlugins: [],
    })),
    getDuplicateOmoPluginWarning: mock(() => ""),
    detectExternalSkillPlugin: mock(() => ({ detected: false, pluginName: null, allPlugins: [] })),
    getSkillPluginConflictWarning: mock(() => ""),
    injectServerAuthIntoClient: mock(() => {}),
    initLiveServerRoute: mock(() => {}),
    setLiveParentWakeRoutingDisabled: mock(() => {}),
    warmLiveServerProbe: mock(() => {}),
    loadPluginConfig: mock(() => ({
      tui: { sidebar: { enabled: false } },
      openclaw: {
        enabled: true,
        gateways: {},
        hooks: {},
        replyListener: { telegramBotToken: "token" },
      },
      disabled_hooks: [],
      experimental: {},
    })) as never,
    initI18n: mock(() => {}),
    initializeOpenClaw: mockInitializeOpenClaw as never,
    stopReplyListener: mockStopReplyListener as never,
    isTmuxIntegrationEnabled: mock(() => false),
    startTmuxCheck: mock(() => {}),
    createFirstMessageVariantGate: mock(() => ({
      shouldOverride: () => false,
      markApplied: () => {},
      markSessionCreated: () => {},
      clear: () => {},
    })),
    createRuntimeTmuxConfig: mock(() => ({
      enabled: false,
      layout: "tiled",
      main_pane_size: 60,
      main_pane_min_width: 80,
      agent_pane_min_width: 40,
      isolation: "inline",
    })) as never,
    createModelCacheState: mock(() => ({})) as never,
    createManagers: mock(() => ({
      backgroundManager: { shutdown: async () => {} },
      skillMcpManager: { disconnectAll: async () => {} },
      configHandler: async () => {},
    })) as never,
    createTools: mockCreateTools as never,
    createRuntimeSkillSourceServer: mock(() => ({
      url: "http://127.0.0.1:49152/runtime-skills",
      stop: mock(() => {}),
    })) as never,
    createHooks: mock(() => ({
      disposeHooks: () => {},
      compactionContextInjector: undefined,
      compactionTodoPreserver: undefined,
      claudeCodeHooks: undefined,
    })) as never,
    createPluginInterface: mock(() => ({})) as never,
  })
}

describe("createPluginModule OpenClaw startup cleanup", () => {
  beforeEach(() => {
    mockCreateTools.mockClear()
    mockInitializeOpenClaw.mockClear()
    mockStopReplyListener.mockClear()
    mockLog.mockClear()
  })

  it("stops the reply listener when startup fails after this instance started it", async () => {
    mockInitializeOpenClaw.mockImplementation(async () => true)
    const pluginModule = createTestPluginModule()

    await expect(
      pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0]),
    ).rejects.toThrow("createTools failed")

    expect(mockInitializeOpenClaw).toHaveBeenCalledTimes(1)
    expect(mockStopReplyListener).toHaveBeenCalledTimes(1)
  })

  it("does not stop a reply listener that was not started by this instance", async () => {
    mockInitializeOpenClaw.mockImplementation(async () => false)
    const pluginModule = createTestPluginModule()

    await expect(
      pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0]),
    ).rejects.toThrow("createTools failed")

    expect(mockInitializeOpenClaw).toHaveBeenCalledTimes(1)
    expect(mockStopReplyListener).not.toHaveBeenCalled()
  })
})
