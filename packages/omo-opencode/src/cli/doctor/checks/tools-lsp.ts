import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createLspMcpConfig } from "../../../mcp/lsp"
import { detectPluginConfigFile, getOpenCodeConfigDir, parseJsonc } from "../../../shared"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../../../shared/plugin-identity"

type OmoConfigForDoctor = {
  disabled_mcps?: string[]
}

type InstalledLspServersOptions = {
  readonly configDirectory?: string
  readonly cwd?: string
}

function readOmoConfig(configDirectory: string): OmoConfigForDoctor | null {
  const detected = detectPluginConfigFile(configDirectory, {
    basenames: [CONFIG_BASENAME],
    legacyBasenames: [LEGACY_CONFIG_BASENAME],
  })
  if (detected.format === "none") {
    return null
  }

  try {
    const content = readFileSync(detected.path, "utf-8")
    return parseJsonc<OmoConfigForDoctor>(content)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    return null
  }
}

function isLspMcpDisabled(options: InstalledLspServersOptions): boolean {
  const userConfigDirectory = options.configDirectory ?? getOpenCodeConfigDir({ binary: "opencode" })
  const projectConfigDirectory = join(options.cwd ?? process.cwd(), ".opencode")
  const userConfig = readOmoConfig(userConfigDirectory)
  const projectConfig = readOmoConfig(projectConfigDirectory)

  const disabledMcps = new Set<string>([
    ...(userConfig?.disabled_mcps ?? []),
    ...(projectConfig?.disabled_mcps ?? []),
  ])

  return disabledMcps.has("lsp")
}

export function getInstalledLspServers(options: InstalledLspServersOptions = {}): Array<{ id: string; extensions: string[] }> {
  if (isLspMcpDisabled(options)) {
    return []
  }

  const lspMcpConfig = createLspMcpConfig({ cwd: options.cwd })

  return lspMcpConfig.enabled ? [{ id: "lsp-tools-mcp", extensions: ["*"] }] : []
}
