import { existsSync } from "fs"
import { join } from "path"
import { derivePluginNameFromKey } from "./plugin-key"
import type {
  LoadedPlugin,
  PluginInstallation,
  PluginManifest,
} from "./types"

function resolveVersion(
  installationVersionValue: string,
  manifestVersionValue: string | undefined,
): string {
  const installationVersionTrim = installationVersionValue.trim()
  const installationVersion =
    installationVersionTrim !== "" && installationVersionTrim !== "unknown"
      ? installationVersionValue
      : null
  const manifestVersionTrim =
    typeof manifestVersionValue === "string" ? manifestVersionValue.trim() : ""
  const manifestVersion = manifestVersionTrim !== "" ? manifestVersionValue : null
  const rawVersion = installationVersionTrim !== "" ? installationVersionValue : null
  return installationVersion ?? manifestVersion ?? rawVersion ?? "unknown"
}

export function createLoadedPlugin(
  pluginKey: string,
  installation: PluginInstallation,
  installPath: string,
  manifest: PluginManifest | null,
): LoadedPlugin {
  const loadedPlugin: LoadedPlugin = {
    name: manifest?.name || derivePluginNameFromKey(pluginKey),
    version: resolveVersion(installation.version, manifest?.version),
    scope: installation.scope,
    installPath,
    pluginKey,
    manifest: manifest ?? undefined,
  }

  if (existsSync(join(installPath, "commands"))) {
    loadedPlugin.commandsDir = join(installPath, "commands")
  }
  if (existsSync(join(installPath, "agents"))) {
    loadedPlugin.agentsDir = join(installPath, "agents")
  }
  if (existsSync(join(installPath, "skills"))) {
    loadedPlugin.skillsDir = join(installPath, "skills")
  }

  const hooksPath = join(installPath, "hooks", "hooks.json")
  if (existsSync(hooksPath)) {
    loadedPlugin.hooksPath = hooksPath
  }

  const mcpPath = join(installPath, ".mcp.json")
  if (existsSync(mcpPath)) {
    loadedPlugin.mcpPath = mcpPath
  }

  return loadedPlugin
}
