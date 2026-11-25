import { join } from "node:path"

import type { ThreadAddressEntry } from "../addressing"
import { createGatewayStore, type GatewayStore } from "../gateway/store"
import type { ProvenanceWorkspaces } from "../gateway/provenance-resolver"
import { createLiveThreadSurface, parseHostStatusAll } from "../live-surface"
import type { RemoteThreadSurface } from "../remote/ports"
import { createGatewayServices } from "../tools/gateway-services"
import { hostView } from "../tools/internals"
import { UNKNOWN_CALLER, type ThreadHost, type ThreadToolSurfaceOptions } from "../tools/ports"

export type ThreadCoreOptions = {
  readonly agentDir: string
  /** The caller's working directory: the workspace a call without `all_scope` is scoped to. */
  readonly cwd: string
  readonly uid: number
  readonly user: string
  readonly env?: Readonly<Record<string, string | undefined>>
  /**
   * The caller's `provenance.workspaces` table. The SDK is a standalone build that does not read omo.json itself;
   * without a table, sends are classified by the caller's environment (`OMO_PROVENANCE_*`) and git owner only.
   */
  readonly provenanceWorkspaces?: ProvenanceWorkspaces
  /** The engine's `host status --all --include-workers --json` stdout; the caller owns how the engine is run. */
  readonly engineStatusAll?: () => Promise<string | undefined>
  /** Where the store worker sidecar is resolved from when this SDK is not loaded from `omo.js`. */
  readonly workerModuleUrl?: string | URL
  readonly host?: ThreadHost
  readonly store?: GatewayStore
  /** How long a create waits for its first prompt to start on this device; absent, FIRST_PROMPT_START_WAIT_MS (test seam). */
  readonly firstPromptWaitMs?: number
  readonly now?: () => number
  /**
   * The account's other devices and its alias registry (the CLI passes the thread client sidecar's `createCliRemoteSurface`):
   * `read` then resolves an address exactly as the agent's `thread_read` does. Absent, it reads this device only; the
   * shipped entry (`extension/thread-sdk.ts`) passes the account surface when its caller passes none (#14616).
   */
  readonly remote?: RemoteThreadSurface
}

/** What every operation of the core shares: the engine host, the gateway store, the tool surface and the pipeline. */
export type ThreadCoreContext = ReturnType<typeof createThreadCoreContext>

export function createThreadCoreContext(options: ThreadCoreOptions) {
  const principal = `cli:${options.uid}`
  const env = { ...(options.env ?? process.env), OMO_CODING_AGENT_DIR: options.agentDir }
  const engineStatusAll = options.engineStatusAll
  const host =
    options.host ??
    createLiveThreadSurface(undefined, {
      env,
      ...(engineStatusAll === undefined ? {} : { statusAll: async () => parseHostStatusAll(await engineStatusAll()) }),
    })
  const store =
    options.store ??
    createGatewayStore({
      agentDir: options.agentDir,
      ...(options.workerModuleUrl === undefined ? {} : { workerModuleUrl: options.workerModuleUrl }),
    })
  const now = options.now ?? store.now
  const workspaces = options.provenanceWorkspaces
  const surface: ThreadToolSurfaceOptions = {
    host,
    store,
    env,
    ...(workspaces === undefined ? {} : { loadProvenanceWorkspaces: () => workspaces }),
    stateDirectory: options.agentDir,
    sessionsDirectory: () => join(options.agentDir, "sessions"),
    callerSessionId: () => UNKNOWN_CALLER,
    callerWorkspaceRoot: () => options.cwd,
    now,
  }
  const view = () => hostView(surface)
  const { pipeline } = createGatewayServices(
    { ...surface, ...(options.remote === undefined ? {} : { remote: options.remote }) },
    () => hostView(surface, { offline: true }),
  )
  const controls: ThreadToolSurfaceOptions = {
    ...surface,
    ...(options.remote === undefined ? {} : { remote: options.remote }),
  }
  // The shared resolver's context, as far as it is fixed for this SDK instance (the local book each call builds
  // is spread in per call). `self` never resolves for the CLI (UNKNOWN_CALLER), exactly as before.
  const resolveContext = (local: readonly ThreadAddressEntry[]) => ({
    remote: options.remote,
    callerWorkspaceRoot: surface.callerWorkspaceRoot(),
    local,
    callerId: UNKNOWN_CALLER,
  })
  return { options, principal, env, host, store, surface, view, pipeline, controls, resolveContext }
}
