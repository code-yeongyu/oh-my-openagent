import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { dirname, resolve } from "node:path"

import type { HostEnginePolicy } from "../../lazy/senpi-barrel"
import { MEMBER_PROCESS_ENV_NAMES, WORKPOOL_PROCESS_ENV_NAMES } from "../../team/member-extension/identity"
import { OMO_SENPI_TASK_DEPTH, OMO_SENPI_TASK_ROOT_SESSION_ID, OMO_SENPI_TASK_RPC_CHILD } from "../rpc/spawn"
import type { DaemonLaunchSpec } from "./launch-spec"

export interface DaemonLaunchOptionsInput {
  readonly spec: DaemonLaunchSpec
  readonly specPath: string
  readonly parentEnv: Readonly<Record<string, string | undefined>>
  readonly idleExitMs: number
  readonly policy: HostEnginePolicy
}

export interface DaemonLaunchOptions {
  readonly hostArgs: readonly string[]
  readonly env: Readonly<Record<string, string | null>>
  readonly policy: { readonly coldStart: "transient" | "persistent"; readonly idleExitMs: number }
  readonly upgrade: "never" | "if-engine-differs"
}

const SESSION_IDLE_EVICTION_ENV = "SENPI_RPC_SESSION_IDLE_EVICTION_MS"
// Mirrors `runners/rpc/spawn.ts`: a per-child session dir belongs to ONE child and must never
// become the machine-wide daemon's.
const CHILD_SESSION_DIR_ENV = "SENPI_CODING_AGENT_SESSION_DIR"

/**
 * The launch spec is the ONLY producer of the daemon's argv and env: nothing else in omo composes
 * `hostArgs`. Extension paths resolve against the spec's own directory, so the same spec works from
 * the npm package, a compiled binary's payload and the desktop's resolved plugin dir.
 */
export function daemonLaunchOptions(input: DaemonLaunchOptionsInput): DaemonLaunchOptions {
  const specDir = dirname(input.specPath)
  const env: Record<string, string | null> = { ...input.spec.env }
  // Child- and member-scoped identity never reaches a host shared by every child on the machine.
  for (const name of [
    OMO_SENPI_TASK_RPC_CHILD,
    OMO_SENPI_TASK_DEPTH,
    OMO_SENPI_TASK_ROOT_SESSION_ID,
    CHILD_SESSION_DIR_ENV,
    ...MEMBER_PROCESS_ENV_NAMES,
    ...WORKPOOL_PROCESS_ENV_NAMES,
  ]) {
    env[name] = null
  }
  // A session must not be evicted before the host itself would idle out, so an inherited window
  // shorter than the idle-exit window is raised to it.
  const inherited = Number.parseInt(input.parentEnv[SESSION_IDLE_EVICTION_ENV] ?? "", 10)
  env[SESSION_IDLE_EVICTION_ENV] = String(
    Number.isFinite(inherited) ? Math.max(inherited, input.idleExitMs) : input.idleExitMs,
  )
  return {
    hostArgs: [
      "--session-runtime",
      input.spec.core.session_runtime,
      ...input.spec.core.extensions.flatMap((path) => ["--extension", resolve(specDir, path)]),
    ],
    env,
    policy: { coldStart: input.spec.tunables.coldStart, idleExitMs: input.idleExitMs },
    upgrade: input.policy === "upgrade" ? "if-engine-differs" : "never",
  }
}

/**
 * omo's view of the host's `launch_profile.profile_id`: sha256 over the canonical JSON of the
 * resolved core (sorted absolute extension roots). The engine computes the same digest from its own
 * argv; a client whose digest differs attaches with a profile warning instead of handing off.
 */
function canonicalDir(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

export function daemonLaunchProfileId(spec: DaemonLaunchSpec, specPath: string): string {
  // The compiled entry reaches the spec through the install prefix while the in-process runner
  // sees the bundle's real location; on macOS /tmp is a symlink and on every platform an install
  // can be. Two spellings of one file must yield one profile, or the second ensure hands the
  // socket over to itself and drops every live session.
  const specDir = canonicalDir(dirname(specPath))
  const core = {
    extensions: spec.core.extensions.map((path) => resolve(specDir, path)).sort(),
    multi_session: spec.core.multi_session,
    session_runtime: spec.core.session_runtime,
  }
  return createHash("sha256").update(JSON.stringify(core)).digest("hex")
}
