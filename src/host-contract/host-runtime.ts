import type { HostCommandRegistry } from "./host-command"
import type { HostConfigRoot } from "./host-config"
import type { HostEventRegistry } from "./host-event"
import type { HostRuntimeIdentity } from "./host-kind"
import type { HostResourceProvider } from "./host-resource"
import type { HostSessionContext } from "./host-session"
import type { HostToolRegistry } from "./host-tool"

export type HostCapabilities = {
  tools: boolean
  commands: boolean
  resources: boolean
  providerHooks: boolean
  contextTransforms: boolean
  compaction: boolean
  mcp: boolean
  backgroundTasks: boolean
  teamMode: boolean
}

export type HostRuntime = {
  identity: HostRuntimeIdentity
  configRoot: HostConfigRoot
  capabilities: HostCapabilities
  tools: HostToolRegistry
  commands: HostCommandRegistry
  events: HostEventRegistry
  resources: HostResourceProvider
  createSessionContext(): HostSessionContext
}

export type HostAdapterFactory<TInput = unknown> = (input: TInput) => HostRuntime | Promise<HostRuntime>
