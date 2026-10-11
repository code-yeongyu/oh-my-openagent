import { readCodexAgentConfig, unmanagedAgentOverrideWarnings } from "./codex-agent-config"
import { writeInstalledMarketplaceSnapshot, type MarketplaceSnapshotPluginSource } from "./codex-marketplace-snapshot"
import { capturePreservedAgentReasoning, capturePreservedAgentServiceTier, linkCachedPluginAgents } from "./link-cached-plugin-agents"
import type { CodexAgentConfig, InstalledPlugin, MarketplaceManifest } from "./types"

export async function linkInstalledPluginAgents(input: {
  readonly codexHome: string
  readonly projectDirectory: string
  readonly env: { readonly [key: string]: string | undefined }
  readonly platform: NodeJS.Platform
  readonly log: (message: string) => void
  readonly marketplace: MarketplaceManifest
  readonly installed: readonly InstalledPlugin[]
  readonly pluginSources: readonly MarketplaceSnapshotPluginSource[]
}): Promise<readonly CodexAgentConfig[]> {
  const { codexHome, log } = input
  const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })
  const preservedServiceTier = await capturePreservedAgentServiceTier({ codexHome })
  const agentSourceRoots = await agentSourceRootsForInstall(input)
  const omoConfig = readCodexAgentConfig({ cwd: input.projectDirectory, env: input.env })
  for (const warning of omoConfig.warnings) log(`Warning: ${warning}`)
  const agentConfigs = new Map<string, CodexAgentConfig>()
  for (const plugin of input.installed) {
    const agentLinks = await linkCachedPluginAgents({
      codexHome,
      pluginRoot: agentSourceRoots.get(plugin.name) ?? plugin.path,
      platform: input.platform,
      preservedReasoning,
      preservedServiceTier,
      defaultRoleEnabled: omoConfig.defaultRoleEnabled,
      agentOverrides: omoConfig.agentOverrides,
    })
    for (const link of agentLinks) {
      log(`Linked agent ${link.name} -> ${link.target}`)
      const agentName = agentNameFromToml(link.name)
      agentConfigs.set(agentName, { name: agentName, configFile: `./agents/${link.name}` })
    }
  }
  for (const warning of unmanagedAgentOverrideWarnings(omoConfig.agentOverrides, new Set(agentConfigs.keys()))) {
    log(`Warning: ${warning}`)
  }
  return [...agentConfigs.values()].sort((left, right) => left.name.localeCompare(right.name))
}

async function agentSourceRootsForInstall(input: {
  readonly codexHome: string
  readonly marketplace: MarketplaceManifest
  readonly installed: readonly InstalledPlugin[]
  readonly pluginSources: readonly MarketplaceSnapshotPluginSource[]
}): Promise<ReadonlyMap<string, string>> {
  if (input.marketplace.name !== "sisyphuslabs") {
    return new Map(input.installed.map((plugin) => [plugin.name, plugin.path]))
  }
  const snapshotPlugins = await writeInstalledMarketplaceSnapshot({
    codexHome: input.codexHome,
    marketplace: input.marketplace,
    plugins: input.pluginSources,
  })
  return new Map(snapshotPlugins.map((plugin) => [plugin.name, plugin.path]))
}

function agentNameFromToml(fileName: string): string {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName
}
