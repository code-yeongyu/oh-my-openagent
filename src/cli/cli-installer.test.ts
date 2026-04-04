import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as configManager from "./config-manager"
import { runCliInstaller } from "./cli-installer"
import type { InstallArgs } from "./types"

function createCacheRepairResult(
  status: "healthy" | "repaired" | "failed",
  success: boolean
) {
  const location = {
    entry: "oh-my-openagent",
    source: "npm" as const,
    packageName: "oh-my-openagent",
    cacheDir: "/tmp/opencode/packages/oh-my-openagent",
    cachePackagePath: "/tmp/opencode/packages/oh-my-openagent/package.json",
    cacheLockfilePath: "/tmp/opencode/packages/oh-my-openagent/package-lock.json",
    installedPackageJsonPath: "/tmp/opencode/packages/oh-my-openagent/node_modules/oh-my-openagent/package.json",
  }

  return {
    success,
    status,
    attempted: status !== "healthy",
    initialInspection: {
      entry: "oh-my-openagent",
      status: success ? "corrupt" : "missing",
      location,
      requiredPaths: [],
      missingPaths: [],
    },
    finalInspection: {
      entry: "oh-my-openagent",
      status: success ? "healthy" : "corrupt",
      location,
      requiredPaths: [],
      missingPaths: success ? [] : [location.cacheLockfilePath],
    },
    attempts: [],
    error: success ? undefined : "Cache repair failed",
  }
}

describe("runCliInstaller", () => {
  const mockConsoleLog = mock(() => {})
  const mockConsoleError = mock(() => {})
  const originalConsoleLog = console.log
  const originalConsoleError = console.error

  beforeEach(() => {
    console.log = mockConsoleLog
    console.error = mockConsoleError
    mockConsoleLog.mockClear()
    mockConsoleError.mockClear()
  })

  afterEach(() => {
    console.log = originalConsoleLog
    console.error = originalConsoleError
  })

  it("completes installation without auth plugin or provider config steps", async () => {
    //#given
    const restoreSpies = [
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: false,
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
      }),
      spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true),
      spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.0.200"),
      spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
        success: true,
        configPath: "/tmp/opencode.jsonc",
        pluginEntry: "oh-my-openagent",
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
      spyOn(configManager, "repairPluginCache").mockResolvedValue(createCacheRepairResult("repaired", true)),
    ]

    const args: InstallArgs = {
      tui: false,
      claude: "no",
      openai: "yes",
      gemini: "no",
      copilot: "yes",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      kimiForCoding: "no",
    }

    //#when
    const result = await runCliInstaller(args, "3.4.0")

    //#then
    expect(result).toBe(0)

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
  })

  it("repairs the plugin cache after registration when OpenCode is installed", async () => {
    //#given
    const addPluginSpy = spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
      success: true,
      configPath: "/tmp/opencode.jsonc",
      pluginEntry: "oh-my-openagent@latest",
    })
    const writeConfigSpy = spyOn(configManager, "writeOmoConfig").mockReturnValue({
      success: true,
      configPath: "/tmp/oh-my-opencode.jsonc",
    })
    const repairSpy = spyOn(configManager, "repairPluginCache").mockResolvedValue(
      createCacheRepairResult("repaired", true)
    )
    const restoreSpies = [
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: false,
        hasClaude: true,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
      }),
      spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true),
      spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.3.14"),
      addPluginSpy,
      writeConfigSpy,
      repairSpy,
    ]
    const args: InstallArgs = {
      tui: false,
      claude: "yes",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      kimiForCoding: "no",
    }

    //#when
    const result = await runCliInstaller(args, "3.4.0")

    //#then
    expect(result).toBe(0)
    expect(addPluginSpy).toHaveBeenCalled()
    expect(writeConfigSpy).toHaveBeenCalled()
    expect(repairSpy).toHaveBeenCalledWith("oh-my-openagent@latest")

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
  })

  it("warns on cache repair failure without aborting installation", async () => {
    //#given
    const repairSpy = spyOn(configManager, "repairPluginCache").mockResolvedValue(
      createCacheRepairResult("failed", false)
    )
    const restoreSpies = [
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: false,
        hasClaude: true,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: false,
        hasCopilot: false,
        hasOpencodeZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
      }),
      spyOn(configManager, "isOpenCodeInstalled").mockResolvedValue(true),
      spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.3.14"),
      spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
        success: true,
        configPath: "/tmp/opencode.jsonc",
        pluginEntry: "oh-my-openagent",
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
      repairSpy,
    ]
    const args: InstallArgs = {
      tui: false,
      claude: "yes",
      openai: "no",
      gemini: "no",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      kimiForCoding: "no",
    }

    //#when
    const result = await runCliInstaller(args, "3.4.0")

    //#then
    expect(result).toBe(0)
    expect(repairSpy).toHaveBeenCalledWith("oh-my-openagent")
    expect(mockConsoleLog.mock.calls.flat().join("\n")).toContain("could not be repaired automatically")

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
  })
})
