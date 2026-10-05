import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readCodexAgentConfig, unmanagedAgentOverrideWarnings } from "./codex-agent-config"

async function homeWithConfig(config: unknown): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "omo-codex-agent-config-"))
  await mkdir(join(home, ".omo"), { recursive: true })
  await writeFile(join(home, ".omo", "omo.jsonc"), JSON.stringify(config))
  return home
}

function readFor(home: string, extraEnv: Record<string, string> = {}) {
  return readCodexAgentConfig({ cwd: home, env: { HOME: home, ...extraEnv } })
}

describe("readCodexAgentConfig agent overrides", () => {
  test("#given [codex].agents model and reasoning #when read #then the Codex override maps reasoning to model_reasoning_effort", async () => {
    const home = await homeWithConfig({ "[codex]": { agents: { explorer: { model: "gpt-6-luna", reasoning: "medium" } } } })

    const config = readFor(home)

    expect(config.agentOverrides.get("explorer")).toEqual({ model: "gpt-6-luna", reasoningEffort: "medium" })
  })

  test("#given only shared base agents #when read #then OpenCode model ids never reach Codex overrides", async () => {
    const home = await homeWithConfig({ agents: { librarian: { model: "anthropic/claude-sonnet-4-6" } } })

    const config = readFor(home)

    expect(config.agentOverrides.size).toBe(0)
  })

  test("#given a model reasoning suffix and off reasoning #when read #then the suffix splits and off becomes none", async () => {
    const home = await homeWithConfig({
      "[codex]": { agents: { plan: { model: "gpt-6-astra:xhigh" }, momus: { model: "gpt-6-astra", reasoning: "off" } } },
    })

    const config = readFor(home)

    expect(config.agentOverrides.get("plan")).toEqual({ model: "gpt-6-astra", reasoningEffort: "xhigh" })
    expect(config.agentOverrides.get("momus")).toEqual({ model: "gpt-6-astra", reasoningEffort: "none" })
  })

  test("#given an active profile with its own [codex] agents #when read #then the profile value wins", async () => {
    const home = await homeWithConfig({
      "[codex]": { agents: { explorer: { model: "gpt-6-luna" } } },
      profiles: { cheap: { "[codex]": { agents: { explorer: { model: "gpt-5.6-luna" } } } } },
    })

    const config = readFor(home, { OMO_PROFILE: "cheap" })

    expect(config.agentOverrides.get("explorer")?.model).toBe("gpt-5.6-luna")
  })

  test("#given the default role disable switch #when read #then it is not a model override", async () => {
    const home = await homeWithConfig({ "[codex]": { agents: { default: { disable: true } } } })

    const config = readFor(home)

    expect(config.defaultRoleEnabled).toBe(false)
    expect(config.agentOverrides.size).toBe(0)
  })

  test("#given an override for an unmanaged role #when warnings are computed #then only that role is reported", () => {
    const overrides = new Map([["explorer", { model: "gpt-6-luna" }], ["oracle", { model: "gpt-6-luna" }]])

    const warnings = unmanagedAgentOverrideWarnings(overrides, new Set(["explorer"]))

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toStartWith("[codex].agents.oracle ")
  })
})
