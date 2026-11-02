import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { capturePreservedAgentReasoning, linkCachedPluginAgents } from "./link-cached-plugin-agents"

describe("managed agent model across re-sync", () => {
  test("#given a user hand-set the explorer model #when agents are re-linked #then the user model survives", async () => {
    const { codexHome, pluginRoot } = await makeAgentFixture()
    await writeInstalled(codexHome, "explorer", agentToml("explorer", "gpt-6-luna", "low"))
    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })

    await linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning })

    expect(await readAgentSetting(codexHome, "explorer", "model")).toBe("gpt-6-luna")
    expect(await readAgentSetting(codexHome, "explorer", "model_reasoning_effort")).toBe("low")
  })

  test("#given an installed model LazyCodex bundled earlier #when agents are re-linked #then it upgrades to the new bundled model", async () => {
    const { codexHome, pluginRoot } = await makeAgentFixture()
    await writeInstalled(codexHome, "explorer", agentToml("explorer", "gpt-5.6-luna", "low"))
    await writeInstalled(codexHome, "librarian", agentToml("librarian", "gpt-5.6-terra", "low"))

    await linkCachedPluginAgents({ codexHome, pluginRoot })

    expect(await readAgentSetting(codexHome, "explorer", "model")).toBe("gpt-6-astra")
    expect(await readAgentSetting(codexHome, "librarian", "model")).toBe("gpt-6-astra")
  })

  test("#given a receipt from a previous sync #when the user hand-sets a model LazyCodex once bundled #then that choice survives", async () => {
    const { codexHome, pluginRoot } = await makeAgentFixture()
    await linkCachedPluginAgents({ codexHome, pluginRoot })
    await writeInstalled(codexHome, "explorer", agentToml("explorer", "gpt-5.5", "low"))

    await linkCachedPluginAgents({ codexHome, pluginRoot })

    expect(await readAgentSetting(codexHome, "explorer", "model")).toBe("gpt-5.5")
    expect(await readAgentSetting(codexHome, "librarian", "model")).toBe("gpt-6-astra")
  })

  test("#given an omo.jsonc override for a role #when agents are re-linked twice #then the override is applied both times", async () => {
    const { codexHome, pluginRoot } = await makeAgentFixture()
    const agentOverrides = new Map([["explorer", { model: "gpt-6-luna", reasoningEffort: "medium" }]])

    await linkCachedPluginAgents({ codexHome, pluginRoot, agentOverrides })
    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })
    await linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning, agentOverrides })

    expect(await readAgentSetting(codexHome, "explorer", "model")).toBe("gpt-6-luna")
    expect(await readAgentSetting(codexHome, "explorer", "model_reasoning_effort")).toBe("medium")
    expect(await readAgentSetting(codexHome, "librarian", "model")).toBe("gpt-6-astra")
  })

  test("#given an override was applied #when the user removes it and agents are re-linked #then the bundled defaults return", async () => {
    const { codexHome, pluginRoot } = await makeAgentFixture()
    const agentOverrides = new Map([["explorer", { model: "gpt-6-luna", reasoningEffort: "medium" }]])
    await linkCachedPluginAgents({ codexHome, pluginRoot, agentOverrides })

    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })
    await linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning })

    expect(await readAgentSetting(codexHome, "explorer", "model")).toBe("gpt-6-astra")
    expect(await readAgentSetting(codexHome, "explorer", "model_reasoning_effort")).toBe("low")
  })

  test("#given an override for a role LazyCodex does not manage #when agents are re-linked #then no agent file is created for it", async () => {
    const { codexHome, pluginRoot } = await makeAgentFixture()
    const agentOverrides = new Map([["oracle", { model: "gpt-6-luna" }]])

    const linked = await linkCachedPluginAgents({ codexHome, pluginRoot, agentOverrides })

    expect(linked.map((entry) => entry.name).sort()).toEqual(["explorer.toml", "librarian.toml"])
  })
})

async function makeAgentFixture(): Promise<{ readonly codexHome: string; readonly pluginRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "omo-codex-agent-model-"))
  const codexHome = join(root, "codex")
  const pluginRoot = join(root, "plugin")
  const agentsDir = join(pluginRoot, "components", "ultrawork", "agents")
  await mkdir(agentsDir, { recursive: true })
  await writeFile(join(agentsDir, "explorer.toml"), agentToml("explorer", "gpt-6-astra", "low"))
  await writeFile(join(agentsDir, "librarian.toml"), agentToml("librarian", "gpt-6-astra", "low"))
  return { codexHome, pluginRoot }
}

async function writeInstalled(codexHome: string, agentName: string, content: string): Promise<void> {
  await mkdir(join(codexHome, "agents"), { recursive: true })
  await writeFile(join(codexHome, "agents", `${agentName}.toml`), content)
}

function agentToml(name: string, model: string, effort: string): string {
  return `name = "${name}"\nmodel = "${model}"\nmodel_reasoning_effort = "${effort}"\nservice_tier = "fast"\n`
}

async function readAgentSetting(codexHome: string, agentName: string, key: string): Promise<string> {
  const content = await readFile(join(codexHome, "agents", `${agentName}.toml`), "utf8")
  const match = new RegExp(`^${key}\\s*=\\s*"([^"]+)"$`, "m").exec(content)
  if (match?.[1] === undefined) throw new Error(`missing ${key} for ${agentName}`)
  return match[1]
}
