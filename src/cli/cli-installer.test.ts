import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as configManager from "./config-manager"
import { runCliInstaller } from "./cli-installer"
import type { InstallArgs } from "./types"

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
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
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
})
