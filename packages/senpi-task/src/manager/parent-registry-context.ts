import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import { asSenpiThinkingLevel } from "../senpi/thinking-level"
import type { InProcessSessionContext, InProcessSessionContextProvider } from "./runner"
import type { ManagedStartSpec } from "./types"

// The concrete senpi ModelRegistry the parent session owns. `createAgentSession` needs this exact
// class (not a structural port) so the child resolves the SAME provider set - including providers
// registered dynamically on the parent (an -e extension provider, a runtime `registerProvider`).
export type ChildModelRegistry = NonNullable<CreateAgentSessionOptions["modelRegistry"]>

// Returns the parent session's live model registry, captured from the senpi ExtensionContext. Returns
// undefined before the first live context (headless / early unit runs) so the child falls back to
// senpi's own default resolution rather than spawning against a half-built registry.
export type ParentModelRegistryResolver = () => ChildModelRegistry | undefined

// The minimal read surface `findModelReference` needs: a `find(provider, modelId)` lookup. The concrete
// ModelRegistry satisfies it structurally, and a test fake satisfies it without constructing the class.
type ModelFinder<TModel> = {
  readonly find: (provider: string, modelId: string) => TModel | undefined
}

/**
 * Build the per-child in-process session context provider that threads the PARENT session's model
 * registry (and the auth storage bound to it) into every in-process child, then resolves the plan's
 * `provider/modelId` model reference to a concrete Model against that same registry. This closes the
 * W2-V gap where a child created with the parent's default agent-dir resolution never saw a provider
 * registered on the live parent session and failed with "No API key found".
 */
export function createParentRegistrySessionContext(
  resolveRegistry: ParentModelRegistryResolver,
): InProcessSessionContextProvider {
  return (spec: ManagedStartSpec): InProcessSessionContext => {
    const registry = resolveRegistry()
    if (registry === undefined) return {}
    const model = spec.model === undefined ? undefined : findModelReference(registry, spec.model)
    const thinkingLevel = asSenpiThinkingLevel(spec.variant)
    return {
      modelRegistry: registry,
      authStorage: registry.authStorage,
      ...(model !== undefined && { model }),
      ...(thinkingLevel !== undefined && { thinkingLevel }),
    }
  }
}

/**
 * Resolve a canonical `provider/modelId` reference (the planner's own encoding) against a registry.
 * The split is on the FIRST slash so an openrouter-style modelId that embeds further slashes keeps
 * them, and an absent or edge-positioned slash yields undefined without a lookup.
 */
export function findModelReference<TModel>(registry: ModelFinder<TModel>, modelReference: string): TModel | undefined {
  const slash = modelReference.indexOf("/")
  if (slash <= 0 || slash === modelReference.length - 1) return undefined
  return registry.find(modelReference.slice(0, slash), modelReference.slice(slash + 1))
}
