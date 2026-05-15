import type { FallbackEntry } from "./model-requirements"
import type { ModelFallbackControllerAccessor } from "../hooks/model-fallback"
import { createInternalAgentTextPart } from "./internal-initiator-marker"
import { SessionCategoryRegistry } from "./session-category-registry"

export type DelegatedChildSessionRetryPart = {
  type: "text"
  text: string
}

export type DelegatedChildSessionBootstrap = {
  retryParts: DelegatedChildSessionRetryPart[]
}

const delegatedChildSessionBootstrapMap = new Map<string, DelegatedChildSessionBootstrap>()

export function createDelegatedChildSessionRetryParts(promptText: string): DelegatedChildSessionRetryPart[] {
  return [createInternalAgentTextPart(promptText)]
}

export function registerDelegatedChildSessionBootstrap(args: {
  sessionID: string
  promptText: string
  fallbackChain?: FallbackEntry[]
  category?: string
  modelFallbackControllerAccessor?: ModelFallbackControllerAccessor
}): void {
  delegatedChildSessionBootstrapMap.set(args.sessionID, {
    retryParts: createDelegatedChildSessionRetryParts(args.promptText),
  })

  args.modelFallbackControllerAccessor?.setSessionFallbackChain(args.sessionID, args.fallbackChain)
  if (args.category) {
    SessionCategoryRegistry.register(args.sessionID, args.category)
  }
}

export function getDelegatedChildSessionBootstrap(sessionID: string): DelegatedChildSessionBootstrap | undefined {
  const bootstrap = delegatedChildSessionBootstrapMap.get(sessionID)
  if (!bootstrap) {
    return undefined
  }

  return {
    retryParts: bootstrap.retryParts.map((part) => ({ ...part })),
  }
}

export function clearDelegatedChildSessionBootstrap(sessionID: string): void {
  delegatedChildSessionBootstrapMap.delete(sessionID)
}

export function clearAllDelegatedChildSessionBootstrap(): void {
  delegatedChildSessionBootstrapMap.clear()
}
