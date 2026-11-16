import { connectDaemon, type DaemonLink } from "./daemon-link.ts"
import type { EnsureCaller, EnsureReply } from "./ensure.ts"

export type AttachOutcome =
  | { readonly kind: "attached"; readonly link: DaemonLink; readonly generation: number }
  | { readonly kind: "refused"; readonly code: "RemoteCommandsDisabled" }

/**
 * The ATTACH-ONLY profile (the SSH bridge, a host outside the graphical session): it has no
 * launcher at all. Before EVERY attach it calls `hand.ensure` on the spawning host's local API,
 * whether or not a daemon is already serving, and dials with the capability that call returned.
 */
export function createAttachOnlyHost(deps: {
  readonly self: EnsureCaller
  readonly ensure: (caller: EnsureCaller) => Promise<EnsureReply>
  readonly connect?: (endpoint: string, capability: Buffer) => Promise<DaemonLink>
}): { attach(): Promise<AttachOutcome> } {
  const connect = deps.connect ?? connectDaemon
  return {
    async attach() {
      const reply = await deps.ensure(deps.self)
      switch (reply.kind) {
        case "refused":
          return reply
        case "ensured":
          return {
            kind: "attached",
            link: await connect(reply.endpoint, Buffer.from(reply.capability, "hex")),
            generation: reply.generation,
          }
        default:
          return reply satisfies never
      }
    },
  }
}
