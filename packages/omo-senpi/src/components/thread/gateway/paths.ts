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

/** The outbox wake hint: rewritten (temp file + rename) whenever an outbox row is written; a connector re-reads its outbox when it changes. */
export function gatewayOutboxMarkerPath(agentDir: string): string {
  return join(gatewayRootDirectory(agentDir), "outbox.marker")
}
