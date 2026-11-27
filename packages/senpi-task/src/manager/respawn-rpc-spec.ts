import type { RespawnResult } from "../lifecycle/port"
import { modelSelector } from "../runners/in-process/runtime-fallback-settings"
import { PersonaTooLargeError } from "../runners/rpc/persona-args"
import type { RpcPersona, RpcRunnerSpec } from "../runners/types"
import type { TaskRecord } from "../state"
import { launchToolAllowlist, type BuildRespawnManagedSpecResult } from "./manager-helpers"
import { failure } from "./respawn-failure"
import { rpcPersona } from "./runner"
import type { TrustedRespawnLaunch } from "./types"

type RespawnLaunchFacts = Omit<RpcRunnerSpec, "task_id" | "cwd" | "state_dir" | "prompt">

/**
 * What a revived out-of-process child is launched with besides where it opens: its model, its trusted
 * runtime inputs, its place in the tree and its persona. Both respawn paths (fresh and resume) build it
 * here, so a revived child never comes back with a wider tool surface than it was started with (#13057).
 */
export function respawnLaunchFacts(
  record: TaskRecord,
  rebuilt: BuildRespawnManagedSpecResult,
  trusted: TrustedRespawnLaunch | undefined,
): RespawnLaunchFacts {
  return {
    model: record.model,
    ...(record.resolved_model?.variant === undefined ? {} : { variant: record.resolved_model.variant }),
    ...(record.fallback_models === undefined ? {} : { fallbackModels: record.fallback_models.map(modelSelector) }),
    ...(trusted?.extensions === undefined ? {} : { extensions: trusted.extensions }),
    ...(trusted?.memberEnv === undefined ? {} : { memberEnv: trusted.memberEnv }),
    depth: record.depth,
    parent_session_id: record.parent_session_id,
    root_session_id: record.root_session_id,
    ...(rebuilt.ok ? rpcPersona(rebuilt.spec) : recordToolPolicy(record)),
  }
}

/** Instructions no carrier can hold never fit on a later try: the revival is given up, not retried. */
export function personaRefusal(error: unknown, cleanupFailure?: string): RespawnResult | undefined {
  if (!(error instanceof PersonaTooLargeError)) return undefined
  return failure("unrecoverable", "respawn_failed", cleanupFailure ?? error.message)
}

// A pre-v1 record cannot rebuild its instructions (it was never launched with any), but its tool policy
// lives on the record itself, so the resumed child keeps the lists it was granted.
function recordToolPolicy(record: TaskRecord): RpcPersona {
  return {
    ...(record.tool_allow === undefined ? {} : { toolAllowlist: launchToolAllowlist(record) }),
    ...(record.tool_deny === undefined ? {} : { toolDenylist: record.tool_deny }),
  }
}
