import type { BrowserAutomationConfig } from "../config/schema/browser-automation"
import { ensureLocalBrowserServer } from "./idm-browser/server/lifecycle"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  oauth: false
}

export async function createIdmBrowserConfig(
  config?: BrowserAutomationConfig,
): Promise<RemoteMcpConfig | undefined> {
  if (config?.engine === undefined) return undefined
  const port = await ensureLocalBrowserServer(config)
  return {
    type: "remote" as const,
    url: `http://127.0.0.1:${port}/mcp`,
    enabled: true,
    oauth: false as const,
  }
}
