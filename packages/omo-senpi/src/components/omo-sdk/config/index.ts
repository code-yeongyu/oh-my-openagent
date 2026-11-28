import { failure } from "../access"
import { ok, type OmoResult, refused } from "../result"
import { type EngineLocation, installedEngineVersion } from "./engine"
import { type ConfigExplanation, explainConfig } from "./explain"
import { type ModelSwaps, readModelSwaps, sessionFileFor } from "./model-swaps"
import { type CheckOptions, checkPolicy, type PolicyCheck } from "./policy"
import { type ConfigStatus, configStatus } from "./status"

export type { ConfigExplanation, ConfigScope, ExplainedLayer, ExplainedValue } from "./explain"
export type { ModelSwap, ModelSwaps } from "./model-swaps"
export type { CheckOptions, ConfigEdit, PolicyCheck } from "./policy"
export type { PolicyFinding, PolicyRule } from "./policy-rules"
export type { ConfigStatus, RoutingEntry } from "./status"

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

/**
 * Reads of the configuration under the security ruling: no key name, path, value, parse text or file path from a
 * config file reaches the caller, except an allowlisted routing key's or typed engine setting's path, its
 * shape-checked value and its scope (`user`, `project`, `global`). A thrown error answers a fixed refusal.
 */
export type ConfigApi = {
  readonly status: () => Promise<OmoResult<ConfigStatus>>
  /** The effective value of one allowlisted key and each layer's value by scope; engine keys take the prefix `engine:`. */
  readonly explain: (options: { readonly path: string }) => Promise<OmoResult<ConfigExplanation>>
  /** Policy findings for the files, or for the files as `edits` would leave them; nothing is written. */
  readonly check: (options?: CheckOptions) => Promise<OmoResult<PolicyCheck>>
  /** The model swaps a session record shows; the calling session's when `session` (a path or id) is omitted. */
  readonly modelSwaps: (options?: { readonly session?: string }) => Promise<OmoResult<ModelSwaps>>
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
    status: () => guarded(() => ok(configStatus(context))),
    explain: (explainOptions) => guarded(() => explainConfig(context, explainOptions.path)),
    check: (checkOptions) => guarded(() => checkPolicy(context, checkOptions)),
    modelSwaps: (swapOptions = {}) =>
      guarded(() => {
        const file = sessionFileFor(swapOptions.session, context)
        return file === undefined
          ? refused(
              "session_not_found",
              "no session record was found",
              "pass { session } as a session file path or id, or run inside a session",
            )
          : ok(readModelSwaps(file))
      }),
  }
}
