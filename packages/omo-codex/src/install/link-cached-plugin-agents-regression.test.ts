import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { capturePreservedAgentReasoning, linkCachedPluginAgents } from "./link-cached-plugin-agents"

describe("managed bundled agent effort migration", () => {
  test("#given old bundled support-agent efforts #when agents are re-linked #then upgrades to current bundled defaults", async () => {
    const { codexHome, pluginRoot } = await makeAgentFixture()
    await mkdir(join(codexHome, "agents"), { recursive: true })
    await writeFile(join(codexHome, "agents", "momus.toml"), agentToml("momus", "gpt-5.5", "xhigh"))
    await writeFile(join(codexHome, "agents", "explorer.toml"), agentToml("explorer", "gpt-5.4-mini", "low"))
    await writeFile(join(codexHome, "agents", "librarian.toml"), agentToml("librarian", "gpt-5.4-mini", "low"))
    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })

    await linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning })

    expect(await readAgentEffort(codexHome, "momus")).toBe("ultra")
    // explorer/librarian chain lands on the newest bundled default (luna/low), 2026-07-11
    expect(await readAgentEffort(codexHome, "explorer")).toBe("low")
    expect(await readAgentEffort(codexHome, "librarian")).toBe("low")
  })

  test("#given custom installed support-agent efforts #when agents are re-linked #then preserves customization", async () => {
    const { codexHome, pluginRoot } = await makeAgentFixture()
    await mkdir(join(codexHome, "agents"), { recursive: true })
    await writeFile(join(codexHome, "agents", "momus.toml"), agentToml("momus", "gpt-5.6-sol", "high"))
    await writeFile(join(codexHome, "agents", "explorer.toml"), agentToml("explorer", "gpt-5.6-terra", "xhigh"))
    await writeFile(join(codexHome, "agents", "librarian.toml"), agentToml("librarian", "gpt-5.6-terra", "high"))
    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })

    await linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning })

    expect(await readAgentEffort(codexHome, "momus")).toBe("high")
    expect(await readAgentEffort(codexHome, "explorer")).toBe("xhigh")
    expect(await readAgentEffort(codexHome, "librarian")).toBe("high")
  })

  test("#given old effort on a non-default model #when agents are re-linked #then preserves customization", async () => {
    const { codexHome, pluginRoot } = await makeAgentFixture()
    await mkdir(join(codexHome, "agents"), { recursive: true })
    await writeFile(join(codexHome, "agents", "explorer.toml"), agentToml("explorer", "gpt-5.5", "low"))
    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })

    await linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning })

    expect(await readAgentEffort(codexHome, "explorer")).toBe("low")
  })
})

async function makeAgentFixture(): Promise<{ readonly codexHome: string; readonly pluginRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "omo-codex-agent-effort-migration-"))
  const codexHome = join(root, "codex")
  const pluginRoot = join(root, "plugin")
  const agentsDir = join(pluginRoot, "components", "ultrawork", "agents")
  await mkdir(agentsDir, { recursive: true })
  await writeFile(join(agentsDir, "momus.toml"), agentToml("momus", "gpt-5.6-sol", "ultra"))
  await writeFile(join(agentsDir, "explorer.toml"), agentToml("explorer", "gpt-5.6-terra", "medium"))
  await writeFile(join(agentsDir, "librarian.toml"), agentToml("librarian", "gpt-5.6-terra", "medium"))
  return { codexHome, pluginRoot }
}

function agentToml(name: string, model: string, effort: string): string {
  return `name = "${name}"\nmodel = "${model}"\nmodel_reasoning_effort = "${effort}"\n`
}

async function readAgentEffort(codexHome: string, agentName: string): Promise<string> {
  const content = await readFile(join(codexHome, "agents", `${agentName}.toml`), "utf8")
  const match = /^model_reasoning_effort\s*=\s*"([^"]+)"$/m.exec(content)
  if (match?.[1] === undefined) throw new Error(`missing model_reasoning_effort for ${agentName}`)
  return match[1]
}
