import type { FallbackEntry } from "./model-requirements"
import type { DelegatedModelConfig } from "./model-resolution-types"

export type CallOmoAgentSessionConfig = { model?: DelegatedModelConfig; fallbackChain?: FallbackEntry[] }

const sessionConfigs = new Map<string, CallOmoAgentSessionConfig>()

function cloneFallbackChain(fallbackChain: FallbackEntry[]): FallbackEntry[] {
  return fallbackChain.map((entry) => ({ ...entry, providers: [...entry.providers] }))
}

function cloneConfig(config: CallOmoAgentSessionConfig): CallOmoAgentSessionConfig {
  return {
    ...(config.model ? { model: { ...config.model, ...(config.model.thinking ? { thinking: { ...config.model.thinking } } : {}) } } : {}),
    ...(config.fallbackChain ? { fallbackChain: cloneFallbackChain(config.fallbackChain) } : {}),
  }
}

export function setCallOmoAgentSessionConfig(sessionID: string, config: CallOmoAgentSessionConfig): void {
  if (config.model || config.fallbackChain?.length) sessionConfigs.set(sessionID, cloneConfig(config))
  else sessionConfigs.delete(sessionID)
}

export function getCallOmoAgentSessionConfig(sessionID: string): CallOmoAgentSessionConfig | undefined {
  const config = sessionConfigs.get(sessionID)
  return config ? cloneConfig(config) : undefined
}

export function getCallOmoAgentSessionFallbackChain(sessionID: string): FallbackEntry[] | undefined {
  return getCallOmoAgentSessionConfig(sessionID)?.fallbackChain
}

export function clearCallOmoAgentSessionFallbackChain(sessionID: string): void {
  sessionConfigs.delete(sessionID)
}

export function clearAllCallOmoAgentSessionFallbackChains(): void {
  sessionConfigs.clear()
}
