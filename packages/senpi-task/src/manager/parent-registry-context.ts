import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import { asSenpiThinkingLevel } from "../senpi/thinking-level"
import { splitModelDecorators } from "../senpi/explicit-pin"
import { RunnerError } from "../runners/in-process/runner-error"
import type {
  InProcessSessionContext,
  InProcessSessionContextProvider,
  ResumeSessionContextResult,
} from "./runner"
import type { ManagedStartSpec } from "./types"

// The concrete senpi ModelRegistry the parent session owns. `createAgentSession` needs this exact
// class (not a structural port) so the child resolves the SAME provider set - including providers
// registered dynamically on the parent (an -e extension provider, a runtime `registerProvider`).
export type ChildModelRegistry = NonNullable<CreateAgentSessionOptions["modelRegistry"]>

// Returns the parent session's live model registry, captured from the senpi ExtensionContext. Returns
// undefined before the first live context (headless / early unit runs); a spec carrying an explicit
// model then fails closed in provide() instead of falling back to senpi's default resolution.
export type ParentModelRegistryResolver = () => ChildModelRegistry | undefined

// Returns the parent session's project-trust decision, or undefined before the first live context.
export type ParentProjectTrustResolver = () => boolean | undefined

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
 *
 * `provide()` ASSERTS rather than filters (#9722): a spec whose `model` cannot resolve - or any
 * spec carrying one before a live registry exists - fails closed with a typed `model_unavailable`
 * RunnerError, exactly as `resolveResumeContext` does. Start and resume share one rule now: never
 * silently hand senpi a model-less context so it substitutes the settings default.
 */
export function createParentRegistrySessionContext(
  resolveRegistry: ParentModelRegistryResolver,
  resolveProjectTrust: ParentProjectTrustResolver = () => undefined,
): InProcessSessionContextProvider {
  const trust = (): Pick<InProcessSessionContext, "projectTrusted"> => {
    const projectTrusted = resolveProjectTrust()
    return projectTrusted === undefined ? {} : { projectTrusted }
  }
  const provide = (spec: ManagedStartSpec): InProcessSessionContext => {
    const registry = resolveRegistry()
    if (registry === undefined) {
      if (spec.model !== undefined) {
        throw new RunnerError({
          kind: "model_unavailable",
          message: `no live parent model registry available to resolve ${spec.model}; refusing the settings default`,
        })
      }
      return trust()
    }
    if (spec.model !== undefined) {
      // A record written before #9722 may still carry a `:level` in its model id; resolve it by its
      // canonical base and let the suffix ride the thinking level instead of failing the respawn.
      const model = findModelReference(registry, spec.model) ?? findModelReference(registry, splitModelDecorators(spec.model).base)
      if (model === undefined) {
        throw new RunnerError({
          kind: "model_unavailable",
          message: `model "${spec.model}" not found in the live parent registry; refusing the settings default`,
        })
      }
      const modelRuntime = registry.modelRuntime
      const thinkingLevel = asSenpiThinkingLevel(spec.variant) ?? asSenpiThinkingLevel(splitModelDecorators(spec.model).thinkingLevel)
      return {
        ...trust(),
        modelRegistry: registry,
        authStorage: registry.authStorage,
        ...(modelRuntime !== undefined && { modelRuntime }),
        model,
        ...(thinkingLevel !== undefined && { thinkingLevel }),
      }
    }
    const modelRuntime = registry.modelRuntime
    const thinkingLevel = asSenpiThinkingLevel(spec.variant)
    return {
      ...trust(),
      modelRegistry: registry,
      authStorage: registry.authStorage,
      ...(modelRuntime !== undefined && { modelRuntime }),
      ...(thinkingLevel !== undefined && { thinkingLevel }),
    }
  }
  return Object.assign(provide, {
    resolveResumeContext: (spec: ManagedStartSpec): ResumeContextResult => {
      const resolved = resolveResumeContext(resolveRegistry, spec)
      return resolved.ok ? { ok: true, context: { ...trust(), ...resolved.context } } : resolved
    },
  })
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

/**
 * Resume-time model resolution that FAILS CLOSED: the exact persisted provider+model_id must
 * resolve in the live registry, else `{ok: false, code: "model_unavailable"}`. Resume NEVER
 * silently drifts to senpi's default model, and the caller must surface the failure as a retryable
 * `deferred` outcome. The resolver keys on `resolved_model.provider` + `resolved_model.model_id`
 * (threaded onto ManagedStartSpec by todo 5) and never on `resolved_model.display`, which is a
 * human string that can differ from the registry id. Does NOT mutate the record.
 */
export function resolveResumeContext(
  resolveRegistry: ParentModelRegistryResolver,
  spec: ManagedStartSpec,
): ResumeContextResult {
  const registry = resolveRegistry()
  if (registry === undefined) {
    return { ok: false, code: "model_unavailable", reason: "no live parent model registry available" }
  }

  const resolvedModel = spec.resolvedModel
  if (resolvedModel === undefined) {
    return { ok: false, code: "model_unavailable", reason: "spec carries no resolved_model to match against" }
  }

  // Key on the canonical provider+model_id pair, NOT on the display string.
  const model = registry.find(resolvedModel.provider, resolvedModel.model_id)
  if (model === undefined) {
    return {
      ok: false,
      code: "model_unavailable",
      reason: `provider "${resolvedModel.provider}" model "${resolvedModel.model_id}" not found in the live registry`,
    }
  }

  const modelRuntime = registry.modelRuntime
  const thinkingLevel = asSenpiThinkingLevel(spec.variant)
  const context: InProcessSessionContext = {
    modelRegistry: registry,
    authStorage: registry.authStorage,
    ...(modelRuntime !== undefined && { modelRuntime }),
    model,
    ...(thinkingLevel !== undefined && { thinkingLevel }),
  }
  return { ok: true, context }
}

export type ResumeContextResult = ResumeSessionContextResult
