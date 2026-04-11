import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as configManager from "./config-manager"
import type { InstallArgs } from "./types"

describe("runCliInstaller telemetry isolation", () => {
  afterEach(() => {
    mock.restore()
  })

  it("does not crash CLI install when telemetry shutdown throws", async () => {
    // given
    const restoreSpies = [
      spyOn(configManager, "detectCurrentConfig").mockReturnValue({
        isInstalled: false,
        installedVersion: null,
        hasClaude: false,
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
      spyOn(configManager, "getOpenCodeVersion").mockResolvedValue("1.4.0"),
      spyOn(configManager, "addPluginToOpenCodeConfig").mockResolvedValue({
        success: true,
        configPath: "/tmp/opencode.jsonc",
      }),
      spyOn(configManager, "writeOmoConfig").mockReturnValue({
        success: true,
        configPath: "/tmp/oh-my-opencode.jsonc",
      }),
    ]

    mock.module("../shared/posthog", () => ({
      createCliPostHog: mock(() => ({
        trackActive: mock(() => {}),
        capture: mock(() => {}),
        captureException: mock(() => {}),
        shutdown: mock(async () => {
          throw new Error("shutdown failed")
        }),
      })),
      getPostHogDistinctId: mock(() => "install-distinct-id"),
    }))

    const { runCliInstaller } = await import(`./cli-installer?telemetry=${Date.now()}-${Math.random()}`)
    const args: InstallArgs = {
      tui: false,
      claude: "no",
      openai: "yes",
      gemini: "no",
      copilot: "yes",
      opencodeZen: "no",
      zaiCodingPlan: "no",
      kimiForCoding: "no",
      opencodeGo: "no",
    }

    // when
    const result = await runCliInstaller(args, "3.4.0")

    // then
    expect(result).toBe(0)

    for (const spy of restoreSpies) {
      spy.mockRestore()
    }
  })
})
