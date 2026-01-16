import { afterEach, describe, expect, test } from "bun:test"

import { buildSubagentSettingsBlock } from "./subagent-settings"
import { clearRuntimePluginConfig, setRuntimePluginConfig } from "./runtime-plugin-config"

describe("subagent-settings", () => {
  afterEach(() => {
    clearRuntimePluginConfig()
  })

  test("renders fallback values without config", () => {
    const text = buildSubagentSettingsBlock({ directory: "/tmp/test" })
    expect(text).toContain("<SUBAGENT_SETTINGS>")
    expect(text).toContain("runtime fallback 5")
    expect(text).toContain("background_task.providerConcurrency")
    expect(text).toContain("background tasks TTL: 30 minutes")
  })

  test("renders configured concurrency values", () => {
    setRuntimePluginConfig({
      background_task: {
        defaultConcurrency: 7,
        providerConcurrency: { anthropic: 3 },
        modelConcurrency: { "anthropic/claude-opus-4-5": 1 },
      },
      disabled_agents: ["oracle"],
    } as any)

    const text = buildSubagentSettingsBlock({ directory: "/repo" })
    expect(text).toContain("background_task.defaultConcurrency: 7")
    expect(text).toContain('"anthropic":3')
    expect(text).toContain('"anthropic/claude-opus-4-5":1')
    expect(text).toContain("disabled_agents")
    expect(text).toContain("oracle")
  })
})
