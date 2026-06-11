import type { HostKind } from "./host-kind"

export type HostResourceKind = "skill" | "prompt" | "theme" | "agent" | "command" | "context-file"

export type HostResourcePath = {
  kind: HostResourceKind
  path: string
  source: "builtin" | "project" | "user" | "extension" | "legacy"
}

export type HostResourceDiscoveryReason = "startup" | "reload" | "manual"

export type HostResourceDiscoveryRequest = {
  host: HostKind
  cwd: string
  reason: HostResourceDiscoveryReason
}

export type HostResourceDiscoveryResult = {
  resources: readonly HostResourcePath[]
  diagnostics?: readonly HostResourceDiagnostic[]
}

export type HostResourceDiagnostic = {
  level: "info" | "warning" | "error"
  message: string
  path?: string
}

export type HostResourceProvider = {
  discoverResources(request: HostResourceDiscoveryRequest): Promise<HostResourceDiscoveryResult>
}
