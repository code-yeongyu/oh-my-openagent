import { beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getLocale, initI18n, t } from "../shared/i18n"
import { PLUGIN_NAME } from "../shared"
import { createPluginModule } from "./create-plugin-module"
import { getMisplacedCategoryConfigDiagnostics } from "./misplaced-category-config"

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
const mockRunOpenCodeStartupMigration = mock(() => ({
  journalResumed: false,
  migratedFrom: [],
  reloadRequired: false,
  results: [],
  skippedConflictCount: 0,
}))
const mockLoadPluginConfig = mock(() => ({}))
const mockLoadConfigChain = mock((directory: string) => ({
  config: mockLoadPluginConfig(directory, {}),
  messages: [],
  path: null,
  valid: true,
}))
const mockGetMisplacedCategoryConfigDiagnostics = mock((_directory: string) => [] as string[])
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
const mockTuiStateMirrorStop = mock(() => {})
const mockCreateManagers = mock(() => ({
  backgroundManager: { shutdown: async () => {} },
  skillMcpManager: { disconnectAll: async () => {} },
  tuiStateMirror: { stop: mockTuiStateMirrorStop },
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

function createTestPluginModule(overrides: Parameters<typeof createPluginModule>[0] = {}): ReturnType<typeof createPluginModule> {
  return createPluginModule({
    initConfigContext: mockInitConfigContext,
    detectExternalSkillPlugin: mockDetectExternalSkillPlugin,
    getSkillPluginConflictWarning: mockGetSkillPluginConflictWarning,
    detectDuplicateOmoPlugin: mockDetectDuplicateOmoPlugin,
    getDuplicateOmoPluginWarning: mockGetDuplicateOmoPluginWarning,
    injectServerAuthIntoClient: mockInjectServerAuthIntoClient,
    logLegacyPluginStartupWarning: mockLogLegacyPluginStartupWarning,
    migrateLegacyWorkspaceDirectory: mockMigrateLegacyWorkspaceDirectory,
    runOpenCodeStartupMigration: mockRunOpenCodeStartupMigration,
    loadConfigChain: mockLoadConfigChain as never,
    loadPluginConfig: mockLoadPluginConfig as never,
    getMisplacedCategoryConfigDiagnostics: mockGetMisplacedCategoryConfigDiagnostics,
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
    ...overrides,
  })
}

describe("createPluginModule()", () => {
  beforeEach(() => {
    mockDetectDuplicateOmoPlugin.mockClear()
    mockGetDuplicateOmoPluginWarning.mockClear()
    mockInjectServerAuthIntoClient.mockClear()
    mockLoadPluginConfig.mockClear()
    mockLoadConfigChain.mockClear()
    mockGetMisplacedCategoryConfigDiagnostics.mockClear()
    mockGetMisplacedCategoryConfigDiagnostics.mockImplementation(() => [])
    mockRunOpenCodeStartupMigration.mockClear()
    mockCreateManagers.mockClear()
    mockTuiStateMirrorStop.mockClear()
    mockRuntimeSkillSourceStop.mockClear()
    mockCreateRuntimeSkillSourceServer.mockClear()
    mockCreateTools.mockClear()
    mockCreateHooks.mockClear()
    mockCreatePluginInterface.mockClear()
    mockRunOpenCodeStartupMigration.mockReturnValue({
      journalResumed: false,
      migratedFrom: [],
      reloadRequired: false,
      results: [],
      skippedConflictCount: 0,
    })
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

  describe("#given OpenCode server config is present", () => {
    it("#then startup self-heals the matching TUI plugin entry", async () => {
      // given
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
      const configDir = mkdtempSync(join(tmpdir(), "omo-server-tui-entry-"))
      process.env.OPENCODE_CONFIG_DIR = configDir
      writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ plugin: [PLUGIN_NAME] }), "utf-8")

      try {
        const pluginModule = createTestPluginModule()
        mockLoadPluginConfig.mockReturnValue({})

        // when
        await pluginModule.server({
          directory: "/tmp/project",
          client: {},
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(readFileSync(join(configDir, "tui.json"), "utf-8")).toContain(`"${PLUGIN_NAME}"`)
      } finally {
        rmSync(configDir, { recursive: true, force: true })
        if (originalConfigDir === undefined) {
          delete process.env.OPENCODE_CONFIG_DIR
        } else {
          process.env.OPENCODE_CONFIG_DIR = originalConfigDir
        }
      }
    })

    it("#given sidebar is disabled #then startup still writes the TUI entry for BTW", async () => {
      // given
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
      const configDir = mkdtempSync(join(tmpdir(), "omo-server-tui-disabled-"))
      process.env.OPENCODE_CONFIG_DIR = configDir
      writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ plugin: [PLUGIN_NAME] }), "utf-8")

      try {
        const pluginModule = createTestPluginModule()
        mockLoadPluginConfig.mockReturnValue({ tui: { sidebar: { enabled: false } } })

        // when
        await pluginModule.server({
          directory: "/tmp/project",
          client: {},
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(readFileSync(join(configDir, "tui.json"), "utf-8")).toContain(`"${PLUGIN_NAME}"`)
      } finally {
        rmSync(configDir, { recursive: true, force: true })
        if (originalConfigDir === undefined) {
          delete process.env.OPENCODE_CONFIG_DIR
        } else {
          process.env.OPENCODE_CONFIG_DIR = originalConfigDir
        }
      }
    })
  })

  it("#given a worktree boundary #then startup forwards it to config diagnostics", async () => {
    // given
    const directory = "/tmp/project/packages/app"
    const worktree = "/tmp/project"
    const pluginModule = createTestPluginModule()

    // when
    await pluginModule.server({
      directory,
      worktree,
      client: {},
    } as Parameters<typeof pluginModule.server>[0])

    // then
    expect(mockGetMisplacedCategoryConfigDiagnostics).toHaveBeenCalledWith(
      directory,
      { worktreeDirectory: worktree },
    )
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

    it("#then dispose stops the started TUI state mirror", async () => {
      // given
      const pluginModule = createTestPluginModule()

      // when
      const hooks: Awaited<ReturnType<typeof pluginModule.server>> & {
        dispose?: () => Promise<void>
      } = await pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0])
      await hooks.dispose?.()

      // then
      expect(mockTuiStateMirrorStop).toHaveBeenCalledTimes(1)
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

  describe("#given OMO categories are placed in OpenCode configuration", () => {
    beforeEach(() => {
      mockGetMisplacedCategoryConfigDiagnostics.mockImplementation(
        getMisplacedCategoryConfigDiagnostics,
      )
    })

    it("#then startup warns that the category overrides are ignored", async () => {
      // given
      const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-misplaced-categories-"))
      const projectDirectory = join(fixtureRoot, "project")
      const projectConfigDir = join(projectDirectory, ".opencode")
      const targetConfigPath = join(projectDirectory, ".omo", "omo.jsonc")
      const userConfigDir = join(fixtureRoot, "user-config")
      mkdirSync(projectConfigDir, { recursive: true })
      mkdirSync(userConfigDir, { recursive: true })
      const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
      writeFileSync(join(projectConfigDir, "opencode.jsonc"), `{
        "categories": {
          "deep": { "model": "amazon-bedrock/anthropic.claude-opus-4-6-v1:0" }
        }
      }`)
      process.env.OPENCODE_CONFIG_DIR = userConfigDir
      const showToast = mock(async () => ({}))
      const consoleWarn = mock(() => {})
      const originalWarn = console.warn
      console.warn = consoleWarn
      const pluginModule = createTestPluginModule()
      mockLoadPluginConfig.mockReturnValue({})

      try {
        // when
        await pluginModule.server({
          directory: projectDirectory,
          client: { tui: { showToast } },
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(showToast.mock.calls[0]?.[0]).toMatchObject({
          body: {
            title: "Configuration diagnostics",
            message: expect.stringContaining(targetConfigPath),
            variant: "warning",
          },
        })
        expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("opencode.jsonc"))
        expect(mockLog).toHaveBeenCalledWith(
          "[config] ignored misplaced category overrides",
          { diagnostic: expect.stringContaining(targetConfigPath) },
        )
      } finally {
        console.warn = originalWarn
        if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
        rmSync(fixtureRoot, { recursive: true, force: true })
      }
    })

    it("#then a simultaneous migration keeps the diagnostic toast warning-styled", async () => {
      // given
      const configDir = mkdtempSync(join(tmpdir(), "omo-migration-diagnostic-"))
      const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
      writeFileSync(join(configDir, "opencode.jsonc"), `{
        "categories": {
          "deep": { "model": "amazon-bedrock/anthropic.claude-opus-4-6-v1:0" }
        }
      }`)
      process.env.OPENCODE_CONFIG_DIR = configDir
      const runOpenCodeStartupMigration = mock(() => ({
        journalResumed: false,
        migratedFrom: ["/home/alice/.config/opencode/omo.json"],
        reloadRequired: true,
        results: [],
        skippedConflictCount: 0,
      }))
      const showToast = mock(async () => ({}))
      const pluginModule = createTestPluginModule({ runOpenCodeStartupMigration })
      mockLoadPluginConfig.mockReturnValue({})

      try {
        // when
        await pluginModule.server({
          directory: "/tmp/project",
          client: { tui: { showToast } },
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(showToast.mock.calls[0]?.[0]).toMatchObject({
          body: {
            title: "Configuration diagnostics",
            message: expect.stringMatching(/Migrated 1 legacy source.*~\/\.omo\/omo\.jsonc/),
            variant: "warning",
          },
        })
      } finally {
        if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
        rmSync(configDir, { recursive: true, force: true })
      }
    })

    it("#then an explicit OPENCODE_CONFIG file produces a diagnostic", async () => {
      // given
      const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-explicit-categories-"))
      const projectDirectory = join(fixtureRoot, "project")
      const explicitConfig = join(fixtureRoot, "custom-opencode.jsonc")
      const previousConfig = process.env.OPENCODE_CONFIG
      const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
      process.env.OPENCODE_CONFIG = explicitConfig
      process.env.OPENCODE_CONFIG_DIR = join(fixtureRoot, "user-config")
      writeFileSync(explicitConfig, `{
        "categories": {
          "deep": { "model": "amazon-bedrock/anthropic.claude-opus-4-6-v1:0" }
        }
      }`)
      const showToast = mock(async () => ({}))
      const pluginModule = createTestPluginModule()
      mockLoadPluginConfig.mockReturnValue({})

      try {
        // when
        await pluginModule.server({
          directory: projectDirectory,
          client: { tui: { showToast } },
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(showToast.mock.calls[0]?.[0]).toMatchObject({
          body: { message: expect.stringContaining(explicitConfig) },
        })
      } finally {
        if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG
        else process.env.OPENCODE_CONFIG = previousConfig
        if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
        rmSync(fixtureRoot, { recursive: true, force: true })
      }
    })

    it("#then categories in an ancestor project config produce a diagnostic", async () => {
      // given
      const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-ancestor-categories-"))
      const projectRoot = join(fixtureRoot, "workspace")
      const projectDirectory = join(projectRoot, "packages", "app", "src")
      const ancestorConfig = join(projectRoot, "opencode.jsonc")
      const targetConfig = join(projectRoot, ".omo", "omo.jsonc")
      const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
      process.env.OPENCODE_CONFIG_DIR = join(fixtureRoot, "user-config")
      mkdirSync(projectDirectory, { recursive: true })
      writeFileSync(ancestorConfig, `{
        "categories": {
          "deep": { "model": "amazon-bedrock/anthropic.claude-opus-4-6-v1:0" }
        }
      }`)
      const showToast = mock(async () => ({}))
      const pluginModule = createTestPluginModule()
      mockLoadPluginConfig.mockReturnValue({})

      try {
        // when
        await pluginModule.server({
          directory: projectDirectory,
          client: { tui: { showToast } },
        } as Parameters<typeof pluginModule.server>[0])

        // then
        const message = String(showToast.mock.calls[0]?.[0]?.body?.message)
        expect(message).toContain(ancestorConfig)
        expect(message).toContain(targetConfig)
      } finally {
        if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
        rmSync(fixtureRoot, { recursive: true, force: true })
      }
    })

    it("#then every misplaced category source is reported together", async () => {
      // given
      const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-multiple-categories-"))
      const projectDirectory = join(fixtureRoot, "project")
      const directConfig = join(projectDirectory, "opencode.jsonc")
      const nestedConfig = join(projectDirectory, ".opencode", "opencode.jsonc")
      const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
      process.env.OPENCODE_CONFIG_DIR = join(fixtureRoot, "user-config")
      mkdirSync(join(projectDirectory, ".opencode"), { recursive: true })
      const misplacedConfig = `{
        "categories": {
          "deep": { "model": "amazon-bedrock/anthropic.claude-opus-4-6-v1:0" }
        }
      }`
      writeFileSync(directConfig, misplacedConfig)
      writeFileSync(nestedConfig, misplacedConfig)
      const showToast = mock(async () => ({}))
      const consoleWarn = mock(() => {})
      const originalWarn = console.warn
      console.warn = consoleWarn
      const pluginModule = createTestPluginModule()
      mockLoadPluginConfig.mockReturnValue({})

      try {
        // when
        await pluginModule.server({
          directory: projectDirectory,
          client: { tui: { showToast } },
        } as Parameters<typeof pluginModule.server>[0])

        // then
        const message = String(showToast.mock.calls[0]?.[0]?.body?.message)
        expect(message).toContain(directConfig)
        expect(message).toContain(nestedConfig)
        expect(consoleWarn).toHaveBeenCalledTimes(2)
      } finally {
        console.warn = originalWarn
        if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
        rmSync(fixtureRoot, { recursive: true, force: true })
      }
    })

    it("#then an active OpenCode profile preserves its scope in the move hint", async () => {
      // given
      const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-profile-categories-"))
      const profileConfigDir = join(fixtureRoot, "opencode", "profiles", "focused")
      const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
      mkdirSync(profileConfigDir, { recursive: true })
      writeFileSync(join(profileConfigDir, "opencode.jsonc"), `{
        "categories": {
          "deep": { "model": "amazon-bedrock/anthropic.claude-opus-4-6-v1:0" }
        }
      }`)
      process.env.OPENCODE_CONFIG_DIR = profileConfigDir
      const showToast = mock(async () => ({}))
      const pluginModule = createTestPluginModule()
      mockLoadPluginConfig.mockReturnValue({})

      try {
        // when
        await pluginModule.server({
          directory: join(fixtureRoot, "project"),
          client: { tui: { showToast } },
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(showToast.mock.calls[0]?.[0]).toMatchObject({
          body: {
            message: expect.stringContaining('profiles.focused."[opencode]".categories'),
          },
        })
      } finally {
        if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
        rmSync(fixtureRoot, { recursive: true, force: true })
      }
    })

    it("#then Desktop-only OpenCode categories produce a diagnostic", async () => {
      // given
      const fixtureRoot = mkdtempSync(join(tmpdir(), "omo-desktop-categories-"))
      const projectDirectory = join(fixtureRoot, "project")
      const xdgConfig = join(fixtureRoot, "xdg-config")
      const desktopConfigDir = join(xdgConfig, "ai.opencode.desktop")
      const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
      const previousXdgConfig = process.env.XDG_CONFIG_HOME
      const previousClient = process.env.OPENCODE_CLIENT
      const previousChannel = process.env.OPENCODE_CHANNEL
      const previousPlatform = process.platform
      Object.defineProperty(process, "platform", { value: "linux" })
      process.env.OPENCODE_CONFIG_DIR = join(fixtureRoot, "cli-config")
      process.env.OPENCODE_CHANNEL = "prod"
      process.env.OPENCODE_CLIENT = "desktop"
      process.env.XDG_CONFIG_HOME = xdgConfig
      mkdirSync(desktopConfigDir, { recursive: true })
      writeFileSync(join(desktopConfigDir, "opencode.jsonc"), `{
        "categories": {
          "deep": { "model": "amazon-bedrock/anthropic.claude-opus-4-6-v1:0" }
        }
      }`)
      const showToast = mock(async () => ({}))
      const pluginModule = createTestPluginModule()
      mockLoadPluginConfig.mockReturnValue({})

      try {
        // when
        await pluginModule.server({
          directory: projectDirectory,
          client: { tui: { showToast } },
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(showToast.mock.calls[0]?.[0]).toMatchObject({
          body: {
            message: expect.stringContaining(join(desktopConfigDir, "opencode.jsonc")),
          },
        })
      } finally {
        Object.defineProperty(process, "platform", { value: previousPlatform })
        if (previousChannel === undefined) delete process.env.OPENCODE_CHANNEL
        else process.env.OPENCODE_CHANNEL = previousChannel
        if (previousClient === undefined) delete process.env.OPENCODE_CLIENT
        else process.env.OPENCODE_CLIENT = previousClient
        if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
        if (previousXdgConfig === undefined) delete process.env.XDG_CONFIG_HOME
        else process.env.XDG_CONFIG_HOME = previousXdgConfig
        rmSync(fixtureRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given startup migration consumes legacy configuration", () => {
    it("#then startup reloads the config and emits one migration summary toast", async () => {
      // given
      const runOpenCodeStartupMigration = mock(() => ({
        journalResumed: false,
        migratedFrom: ["/home/alice/.config/opencode/omo.json"],
        reloadRequired: true,
        results: [],
        skippedConflictCount: 2,
      }))
      const showToast = mock(async () => ({}))
      const pluginModule = createTestPluginModule({ runOpenCodeStartupMigration })
      mockLoadPluginConfig.mockReturnValue({})

      // when
      await pluginModule.server({
        directory: "/tmp/project",
        client: { tui: { showToast } },
      } as Parameters<typeof pluginModule.server>[0])

      // then
      expect(runOpenCodeStartupMigration).toHaveBeenCalledWith({ cwd: "/tmp/project" })
      expect(showToast).toHaveBeenCalledTimes(1)
      expect(showToast.mock.calls[0]?.[0]).toMatchObject({
        body: {
          title: "Configuration migrated",
          message: expect.stringContaining("1 legacy source"),
          variant: "success",
        },
      })
      expect(mockLoadPluginConfig).toHaveBeenCalledTimes(1)
    })

    it("#then unrelated factory tests stay isolated from host OpenCode categories", async () => {
      // given
      const configDir = mkdtempSync(join(tmpdir(), "omo-host-config-isolation-"))
      const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
      process.env.OPENCODE_CONFIG_DIR = configDir
      writeFileSync(join(configDir, "opencode.jsonc"), `{
        "categories": {
          "deep": { "model": "opencode/big-pickle" }
        }
      }`)
      const runOpenCodeStartupMigration = mock(() => ({
        journalResumed: false,
        migratedFrom: ["/home/alice/.config/opencode/omo.json"],
        reloadRequired: true,
        results: [],
        skippedConflictCount: 0,
      }))
      const showToast = mock(async () => ({}))
      const pluginModule = createTestPluginModule({ runOpenCodeStartupMigration })

      try {
        // when
        await pluginModule.server({
          directory: "/tmp/project",
          client: { tui: { showToast } },
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(showToast.mock.calls[0]?.[0]).toMatchObject({
          body: { title: "Configuration migrated", variant: "success" },
        })
      } finally {
        if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
        rmSync(configDir, { recursive: true, force: true })
      }
    })
  })

  describe("#given serverPlugin is initialized twice in one process", () => {
    it("#then startup migration predicates run only once", async () => {
      // given
      const runOpenCodeStartupMigration = mock(() => ({
        journalResumed: false,
        migratedFrom: [],
        reloadRequired: false,
        results: [],
        skippedConflictCount: 0,
      }))
      const pluginModule = createTestPluginModule({ runOpenCodeStartupMigration })
      const input = { directory: "/tmp/project", client: {} } as Parameters<typeof pluginModule.server>[0]

      // when
      await pluginModule.server(input)
      await pluginModule.server(input)

      // then
      expect(runOpenCodeStartupMigration).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given startup migration fails", () => {
    it("#then startup keeps defaults and reports one loud error toast", async () => {
      // given
      const runOpenCodeStartupMigration = mock(() => ({
        error: "Migration validation failed for ~/.omo/omo.jsonc",
        journalResumed: false,
        migratedFrom: [],
        reloadRequired: false,
        results: [],
        skippedConflictCount: 0,
      }))
      const loadConfigChain = mock(() => ({ config: {}, messages: ["invalid config"], path: null, valid: false }))
      const showToast = mock(async () => ({}))
      const pluginModule = createTestPluginModule({ loadConfigChain, runOpenCodeStartupMigration })
      const consoleWarn = mock(() => {})
      const originalWarn = console.warn
      console.warn = consoleWarn

      try {
        // when
        const hooks = await pluginModule.server({
          directory: "/tmp/project",
          client: { tui: { showToast } },
        } as Parameters<typeof pluginModule.server>[0])

        // then
        expect(hooks).toBeDefined()
        expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("legacy configuration changes were not applied"))
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(showToast.mock.calls[0]?.[0]).toMatchObject({
          body: { title: "Configuration migration failed", variant: "error" },
        })
        expect(mockCreateManagers.mock.calls.at(-1)?.[0]?.pluginConfig).toEqual({})
      } finally {
        console.warn = originalWarn
      }
    })
  })

  describe("#given the omo process sweep during plugin init", () => {
    it("#when the sweep never resolves #then startup still completes fire-and-forget", async () => {
      // given a sweep promise that never settles
      const startOmoProcessSweep = mock(() => new Promise<void>(() => {}))
      const pluginModule = createTestPluginModule({ startOmoProcessSweep })
      mockLoadPluginConfig.mockReturnValue({})

      // when
      const hooks = await pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0])

      // then startup completed without awaiting the sweep
      expect(startOmoProcessSweep).toHaveBeenCalledTimes(1)
      expect(hooks).toBeDefined()
      expect(mockCreatePluginInterface).toHaveBeenCalled()
    })

    it("#when the sweep rejects #then the failure is logged and cannot propagate into startup", async () => {
      // given a sweep that fails immediately
      const startOmoProcessSweep = mock(() => Promise.reject(new Error("sweep boom")))
      const pluginModule = createTestPluginModule({ startOmoProcessSweep })
      mockLoadPluginConfig.mockReturnValue({})
      mockLog.mockClear()

      // when
      const hooks = await pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0])
      // let the fire-and-forget rejection handler run
      await Promise.resolve()
      await Promise.resolve()

      // then startup completed and the failure only reached the log
      expect(hooks).toBeDefined()
      const sweepLogs = mockLog.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("omo process sweep failed"),
      )
      expect(sweepLogs).toHaveLength(1)
    })

    it("#when the sweep throws synchronously #then startup still completes", async () => {
      // given a sweep that throws before returning a promise
      const startOmoProcessSweep = mock(() => {
        throw new Error("sync sweep boom")
      })
      const pluginModule = createTestPluginModule({ startOmoProcessSweep })
      mockLoadPluginConfig.mockReturnValue({})

      // when
      const hooks = await pluginModule.server({
        directory: "/tmp/project",
        client: {},
      } as Parameters<typeof pluginModule.server>[0])

      // then
      expect(hooks).toBeDefined()
      expect(mockCreatePluginInterface).toHaveBeenCalled()
    })
  })
})
