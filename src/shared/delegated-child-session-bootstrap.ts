import type { ModelFallbackControllerAccessor } from "../hooks/model-fallback"
import { createInternalAgentTextPart } from "./internal-initiator-marker"
import type { FallbackEntry } from "./model-requirements"
import { SessionCategoryRegistry } from "./session-category-registry"

export type DelegatedChildSessionRetryPart = {
  type: "text"
  text: string
}

export type DelegatedChildSessionBootstrap = {
  retryParts: DelegatedChildSessionRetryPart[]
  fallbackChain?: FallbackEntry[]
  category?: string
}

const delegatedChildSessionBootstraps = new Map<string, DelegatedChildSessionBootstrap>()

function cloneRetryParts(parts: DelegatedChildSessionRetryPart[]): DelegatedChildSessionRetryPart[] {
  return parts.map((part) => ({ type: part.type, text: part.text }))
}

function cloneFallbackChain(fallbackChain: FallbackEntry[] | undefined): FallbackEntry[] | undefined {
  return fallbackChain?.map((entry) => ({
    ...entry,
    providers: [...entry.providers],
  }))
}

export function registerDelegatedChildSessionBootstrap(_args: {
  sessionID: string
  promptText: string
  fallbackChain?: FallbackEntry[]
  category?: string
  modelFallbackControllerAccessor?: ModelFallbackControllerAccessor
}): void {
  const retryParts = [createInternalAgentTextPart(_args.promptText)]
  const fallbackChain = cloneFallbackChain(_args.fallbackChain)
  delegatedChildSessionBootstraps.set(_args.sessionID, {
    retryParts,
    ...(fallbackChain ? { fallbackChain } : {}),
    ...(_args.category ? { category: _args.category } : {}),
  })

  _args.modelFallbackControllerAccessor?.setSessionFallbackChain(_args.sessionID, fallbackChain)
  if (_args.category) {
    SessionCategoryRegistry.register(_args.sessionID, _args.category)
  }
}

export function getDelegatedChildSessionBootstrap(_sessionID: string): DelegatedChildSessionBootstrap | undefined {
  const bootstrap = delegatedChildSessionBootstraps.get(_sessionID)
  if (!bootstrap) {
    return undefined
  }

  const fallbackChain = cloneFallbackChain(bootstrap.fallbackChain)
  return {
    retryParts: cloneRetryParts(bootstrap.retryParts),
    ...(fallbackChain ? { fallbackChain } : {}),
    ...(bootstrap.category ? { category: bootstrap.category } : {}),
  }
}

export function clearDelegatedChildSessionBootstrap(_sessionID: string): void {
  delegatedChildSessionBootstraps.delete(_sessionID)
}

export function clearAllDelegatedChildSessionBootstrap(): void {
  delegatedChildSessionBootstraps.clear()
}
