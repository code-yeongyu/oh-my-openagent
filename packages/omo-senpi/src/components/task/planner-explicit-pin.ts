import {
  resolveExplicitTaskPin,
  splitModelDecorators,
  type SettingsDefaultRoute,
} from "@oh-my-opencode/senpi-task"

import type { TaskModelRegistry } from "./planner"

// The settings-default route a pin-less child would ride, named in model_unavailable errors so
// the caller sees exactly what the refusal protected it from.
export type ResolveDefaultRoute = () => SettingsDefaultRoute | undefined

type ResolvedModelMetadata = {
  readonly source: "explicit"
  readonly provider: string
  readonly model_id: string
  readonly display: string
  readonly reasoning?: string
}

export type ExplicitPinResolution =
  | { readonly kind: "resolved"; readonly canonical: string; readonly metadata: ResolvedModelMetadata; readonly thinkingLevel?: string }
  | { readonly kind: "error"; readonly error: { readonly code: "invalid_target" | "model_unavailable"; readonly message: string } }

/**
 * Parse an explicit task model pin ONCE and resolve it against the live registry, or fail closed
 * (#9722): the raw `provider/model:level` string is never trusted as a model id again. senpi's own
 * resolver owns the split whenever the registry carries its runtime; a structurally minimal
 * registry (unit fakes) falls back to exact-id `find` on the shared decorator split. Either way a
 * miss is a typed model_unavailable naming the pin and the settings default the child would
 * otherwise have ridden, and a malformed pin is a typed invalid_target.
 */
export function resolveExplicitPin(
  pin: string,
  resolveRegistry: () => TaskModelRegistry | undefined,
  resolveDefaultRoute: ResolveDefaultRoute | undefined,
): ExplicitPinResolution {
  const registry = resolveRegistry()
  if (registry === undefined) {
    return { kind: "error", error: { code: "model_unavailable", message: withDefaultRoute(NO_REGISTRY_MESSAGE, resolveDefaultRoute) } }
  }
  const runtime = registry.modelRuntime
  if (runtime !== undefined) {
    const resolved = resolveExplicitTaskPin(pin, runtime)
    if (resolved.kind !== "resolved") {
      return {
        kind: "error",
        error: {
          code: resolved.kind,
          message: resolved.kind === "model_unavailable" ? withDefaultRoute(resolved.message, resolveDefaultRoute) : resolved.message,
        },
      }
    }
    return explicitPinResolved(pin, resolved.provider, resolved.modelId, resolved.thinkingLevel)
  }
  return resolvePinByExactId(pin, registry, resolveDefaultRoute)
}

export const NO_REGISTRY_MESSAGE = "No senpi model registry is available yet to resolve a task model."

function resolvePinByExactId(
  pin: string,
  registry: TaskModelRegistry,
  resolveDefaultRoute: ResolveDefaultRoute | undefined,
): ExplicitPinResolution {
  const { base, thinkingLevel, serviceTier } = splitModelDecorators(pin.trim())
  const slash = base.indexOf("/")
  if (slash <= 0 || slash === base.length - 1) {
    return {
      kind: "error",
      error: { code: "invalid_target", message: `The task model pin "${pin}" is malformed: use provider/model with an optional :thinking-level suffix.` },
    }
  }
  if (serviceTier !== undefined) {
    return {
      kind: "error",
      error: {
        code: "invalid_target",
        message: `The task model pin "${pin}" carries service tier "${serviceTier}", which a task pin cannot express; drop the suffix or set the tier on the parent.`,
      },
    }
  }
  const provider = base.slice(0, slash)
  const modelId = base.slice(slash + 1)
  const found = registry.find(provider, modelId)
  if (found === undefined) {
    return {
      kind: "error",
      error: {
        code: "model_unavailable",
        message: withDefaultRoute(`The task model pin "${pin}" did not resolve to a model in the live registry.`, resolveDefaultRoute),
      },
    }
  }
  return explicitPinResolved(pin, provider, modelId, thinkingLevel)
}

function explicitPinResolved(
  pin: string,
  provider: string,
  modelId: string,
  thinkingLevel: string | undefined,
): ExplicitPinResolution {
  return {
    kind: "resolved",
    canonical: `${provider}/${modelId}`,
    metadata: {
      source: "explicit",
      provider,
      model_id: modelId,
      display: pin,
      ...(thinkingLevel === undefined ? {} : { reasoning: thinkingLevel }),
    },
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  }
}

function withDefaultRoute(message: string, resolveDefaultRoute: ResolveDefaultRoute | undefined): string {
  const route = resolveDefaultRoute?.()
  return route === undefined
    ? message
    : `${message} The child would otherwise start on the settings default route ${route.provider}/${route.modelId}.`
}
