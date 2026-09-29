import { join } from "node:path"

export function gatewayRootDirectory(agentDir: string): string {
  return join(agentDir, "gateway")
}

export function gatewayDatabasePath(agentDir: string): string {
  return join(gatewayRootDirectory(agentDir), "gateway.sqlite")
}

export function gatewayInboxDirectory(agentDir: string, durableId: string): string {
  return join(gatewayRootDirectory(agentDir), "inbox", durableId)
}
