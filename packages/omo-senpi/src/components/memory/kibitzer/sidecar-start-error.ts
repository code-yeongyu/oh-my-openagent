import type { KibitzerWakeConfiguration } from "./sidecar-outcome"

export type KibitzerSidecarModelUnavailableCause = "registry_snapshot_unavailable" | "category_unavailable" | "beyond_category"

export type KibitzerSidecarStartCode =
  | KibitzerSidecarModelUnavailableCause
  | "persona_unavailable"
  | "runtime_unavailable"
  | "session_create_failed"

/** A child that could not be started, named by the stage that refused; the sidecar backs off on it. */
export class KibitzerSidecarStartError extends Error {
  readonly code: KibitzerSidecarStartCode
  /** The pinned recall category a model-unavailable refusal names. */
  readonly category?: string
  /** The category chain's providers with no connection, when the resolver knew them. */
  readonly missingProviders?: readonly string[]

  constructor(
    code: KibitzerSidecarStartCode,
    message: string,
    options?: { readonly cause?: unknown; readonly category?: string; readonly missingProviders?: readonly string[] },
  ) {
    super(message, options)
    this.name = "KibitzerSidecarStartError"
    this.code = code
    if (options?.category !== undefined) this.category = options.category
    if (options?.missingProviders !== undefined) this.missingProviders = options.missingProviders
  }
}

/**
 * A permanent configuration state, not a transient start failure: the pinned recall category's
 * chain has no connected provider, or resolved only beyond the category (which the advisor
 * refuses). The wake that carries one is reported non-diagnostically and the observability lane
 * answers it with ONE actionable notice per session instead of the failure streak.
 */
export function kibitzerConfigurationFailure(error: unknown): KibitzerWakeConfiguration | undefined {
  if (!(error instanceof KibitzerSidecarStartError)) return undefined
  if (error.code !== "category_unavailable" && error.code !== "beyond_category") return undefined
  if (error.category === undefined) return undefined
  return {
    category: error.category,
    cause: error.code,
    ...(error.missingProviders === undefined ? {} : { missingProviders: error.missingProviders }),
  }
}
