import { failure } from "../access"
import { ok, type OmoResult, refused } from "../result"
import { type EngineLocation, installedEngineVersion } from "./engine"
import { type ConfigExplanation, explainConfig } from "./explain"
import { type ModelSwaps, readModelSwaps, sessionFileFor } from "./model-swaps"
import { type CheckOptions, checkPolicy, type PolicyCheck } from "./policy"
import { type ConfigStatus, configStatus, type StatusOptions } from "./status"

export type { ConfigExplanation, LayerValue } from "./explain"
export type { ModelSwap, ModelSwaps } from "./model-swaps"
export type { CheckOptions, ConfigEdit, PolicyCheck } from "./policy"
export type { PolicyFinding, PolicyRule } from "./policy-rules"
export type { AvailableModel, ConfigFile, ConfigStatus, EngineStatus, RoutingEntry, StatusOptions } from "./status"

export type ConfigPorts = {
  /** The installed engine's version; by default read from the engine package this process resolves. */
  readonly engineVersion?: () => string | undefined
  /** The calling session's record path or id; by default `PI_SESSION_FILE`, else `PI_SESSION_ID`. */
  readonly currentSession?: () => string | undefined
}

export type ConfigContext = EngineLocation & {
  readonly engineVersion: () => string | undefined
  readonly currentSession: () => string | undefined
}

export type ConfigApi = {
  readonly status: (options?: StatusOptions) => Promise<OmoResult<ConfigStatus>>
  /** The effective value of one key and each layer's value; engine keys take the prefix `engine:`. */
  readonly explain: (options: { readonly path: string }) => Promise<OmoResult<ConfigExplanation>>
  /** The model swaps a session record shows; the calling session's when `session` is omitted. */
  readonly modelSwaps: (options?: { readonly session?: string }) => Promise<OmoResult<ModelSwaps>>
  /** Policy findings for the files, or for the files as `edits` would leave them; nothing is written. */
  readonly check: (options?: CheckOptions) => Promise<OmoResult<PolicyCheck>>
}

async function guarded<T>(run: () => OmoResult<T>): Promise<OmoResult<T>> {
  try {
    return run()
  } catch (error) {
    return failure(error)
  }
}

export function createConfigApi(options: {
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly ports?: ConfigPorts
}): ConfigApi {
  const { env } = options
  const context: ConfigContext = {
    cwd: options.cwd,
    env,
    engineVersion: options.ports?.engineVersion ?? installedEngineVersion,
    currentSession:
      options.ports?.currentSession ??
      (() => env["PI_SESSION_FILE"]?.trim() || env["PI_SESSION_ID"]?.trim() || undefined),
  }
  return {
    status: (statusOptions) => guarded(() => ok(configStatus(context, statusOptions))),
    explain: ({ path }) => guarded(() => explainConfig(context, path)),
    modelSwaps: (swapOptions = {}) =>
      guarded(() => {
        const file = sessionFileFor(swapOptions.session, context)
        return file === undefined
          ? refused(
              "session_not_found",
              "no session record was found",
              "pass { session } as a session file path or id, or run inside a session",
              { session: swapOptions.session ?? context.currentSession() ?? null },
            )
          : ok(readModelSwaps(file))
      }),
    check: (checkOptions) => guarded(() => checkPolicy(context, checkOptions)),
  }
}
