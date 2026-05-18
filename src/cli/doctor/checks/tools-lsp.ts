import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createLspMcpConfig } from "../../../mcp/lsp"
import { detectPluginConfigFile, getOpenCodeConfigDir, parseJsonc } from "../../../shared"

type OmoConfigForDoctor = {
  disabled_mcps?: string[]
}

const PROJECT_CONFIG_DIR = join(process.cwd(), ".opencode")

function readOmoConfig(configDirectory: string): OmoConfigForDoctor | null {
  const detected = detectPluginConfigFile(configDirectory)
  if (detected.format === "none") {
    return null
  }

  try {
    const content = readFileSync(detected.path, "utf-8")
    return parseJsonc<OmoConfigForDoctor>(content)
  } catch {
    return null
  }
}

function isLspMcpDisabled(): boolean {
  const userConfigDirectory = getOpenCodeConfigDir({ binary: "opencode" })
  const userConfig = readOmoConfig(userConfigDirectory)
  const projectConfig = readOmoConfig(PROJECT_CONFIG_DIR)

  const disabledMcps = new Set<string>([
    ...(userConfig?.disabled_mcps ?? []),
    ...(projectConfig?.disabled_mcps ?? []),
  ])

  return disabledMcps.has("lsp")
}

export function getInstalledLspServers(): Array<{ id: string; extensions: string[] }> {
  if (isLspMcpDisabled()) {
    return []
  }

  const lspMcpConfig = createLspMcpConfig()

  if (!lspMcpConfig) {
    return []
  }

  return [{ id: "lsp-tools-mcp", extensions: ["*"] }]
}
