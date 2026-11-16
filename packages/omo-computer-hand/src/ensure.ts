import type { DaemonLauncher } from "./launcher.ts"
import type { ProcessIdentity } from "./session-locks.ts"

export type EnsureCaller = ProcessIdentity

export type EnsureReply =
  | { readonly kind: "ensured"; readonly endpoint: string; readonly capability: string; readonly generation: number }
  | { readonly kind: "refused"; readonly code: "RemoteCommandsDisabled" }

class HandRegisterFailed extends Error {
  constructor(detail: string) {
    super(`hand.register failed: ${detail}`)
    this.name = "HandRegisterFailed"
  }
}

/**
 * `hand.ensure`, the spawning host's side of the ONE attach rule (d-remote.md 'Security'): checks
 * the hand-wide remote-commands switch first (nothing spawned, nothing attached when it is off),
 * ensures the daemon (idempotent: a serving daemon spawns nothing), registers the caller as
 * `(pid, processStart)` over the authority connection and returns the capability the daemon
 * minted for that caller's one connection.
 */
export function createHandEnsure(deps: {
  readonly launcher: Pick<DaemonLauncher, "ensure">
  readonly remoteCommandsEnabled: () => boolean
}): (caller: EnsureCaller) => Promise<EnsureReply> {
  return async (caller) => {
    if (!deps.remoteCommandsEnabled()) return { kind: "refused", code: "RemoteCommandsDisabled" }
    const generation = await deps.launcher.ensure()
    const reply = await generation.authority.call("hand.register", {
      pid: caller.pid,
      processStart: caller.processStart,
    })
    const capability: unknown =
      typeof reply.result === "object" && reply.result !== null ? Reflect.get(reply.result, "capability") : undefined
    if (typeof capability !== "string" || !/^[0-9a-f]{64}$/.test(capability)) {
      throw new HandRegisterFailed(JSON.stringify(reply.error ?? reply.result))
    }
    return { kind: "ensured", endpoint: generation.endpoint, capability, generation: generation.generation }
  }
}
