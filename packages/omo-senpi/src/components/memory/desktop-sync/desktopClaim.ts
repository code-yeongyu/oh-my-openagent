// A declared launch's claim of the inherited memory-sync channel (account-transport-api v11 section 7.3): take it once,
// attach within the bootstrap bound, and close an attachment that connects after the answer. It ships in the
// device-account sidecar; hostSelection.ts in omo.js only classifies the launch and memoizes the selection.
//
// The sidecar bundles its own copy of `#senpi-private-fds`, and evaluating that module captures the table (it removes
// SENPI_PRIVATE_FDS from the environment). It is imported only when claimInheritedDesktopSync runs, so importing the
// sidecar captures nothing: an entry that claims at boot reads the gate first and passes its engine's own `take`
// (bootClaim.ts).

import type { Duplex } from "node:stream"
import { attachDesktopSyncChannel } from "./channel"
import type { DesktopSyncEngineWire } from "./desktopSyncAccount"
import { MEMORY_SYNC_CHANNEL, type MemorySyncSelection } from "./hostSelection"

export type DesktopSyncAttachment =
  | { readonly kind: "connected"; readonly channel: DesktopSyncEngineWire }
  | { readonly kind: "unavailable"; readonly reason: "private_channel_unavailable" }

export async function claimDesktopSync(options: {
  readonly take: (name: string) => Duplex | undefined
  readonly attach: (stream: Duplex | undefined) => Promise<DesktopSyncAttachment>
  /** The bootstrap exchange bound; every present port is answered within it (v11 section 7.3). */
  readonly attachDeadlineMs?: number
}): Promise<MemorySyncSelection> {
  const pending = options.attach(options.take(MEMORY_SYNC_CHANNEL))
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<"expired">((resolve) => {
    timer = setTimeout(() => resolve("expired"), options.attachDeadlineMs ?? 10_000)
  })
  const attached = await Promise.race([pending, expired]).finally(() => clearTimeout(timer))
  if (attached === "expired") {
    // A late attachment is discarded: close it so the claimed channel cannot outlive the unavailable answer.
    void pending.then(
      (late) => {
        if (late.kind === "connected") late.channel.close()
      },
      () => undefined,
    )
    return { kind: "unavailable", reason: "private_channel_unavailable" }
  }
  return attached.kind === "connected" ? { kind: "desktop", channel: attached.channel } : attached
}

/** The engine's own claim: senpi's inherited descriptor and the framed desktop channel. */
export async function claimInheritedDesktopSync(): Promise<MemorySyncSelection> {
  const { takeInheritedPrivateChannel } = await import("#senpi-private-fds")
  return claimDesktopSync({ take: takeInheritedPrivateChannel, attach: attachDesktopSyncChannel })
}
