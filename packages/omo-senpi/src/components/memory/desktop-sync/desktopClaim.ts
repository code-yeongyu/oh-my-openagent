// A declared launch's claim of the inherited memory-sync channel (account-transport-api v11 section 7.3): take it once,
// attach within the bootstrap bound, and close an attachment that connects after the answer. The bound is the
// selection's (hostSelection.ts), started before the sidecar loaded: a claim that starts after it passed takes the
// descriptor and closes it without starting the exchange. It ships in the device-account sidecar; hostSelection.ts in
// omo.js only classifies the launch and memoizes the selection.
//
// The sidecar bundles its own copy of `#senpi-private-fds`, and evaluating that module captures the table (it removes
// SENPI_PRIVATE_FDS from the environment). It is imported only when claimInheritedDesktopSync runs, so importing the
// sidecar captures nothing: an entry that claims at boot reads the gate first and passes its engine's own `take`
// (bootClaim.ts). Under every senpi host the engine has already captured the table before any extension module
// evaluates (its CLI entries, and the extension loader's own import graph), so this copy reuses that capture.

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
  /** Aborts when the selection's bootstrap bound passes; every present port is answered within it (v11 section 7.3). */
  readonly deadline: AbortSignal
}): Promise<MemorySyncSelection> {
  const stream = options.take(MEMORY_SYNC_CHANNEL)
  if (options.deadline.aborted) {
    // senpi's take hands disposal of the stream to the caller; past the bound the answer is already unavailable, so
    // the descriptor is closed here, once, instead of starting an exchange nobody waits for.
    stream?.destroy()
    return { kind: "unavailable", reason: "private_channel_unavailable" }
  }
  const pending = options.attach(stream)
  let onExpired = () => {}
  const expired = new Promise<"expired">((resolve) => {
    onExpired = () => resolve("expired")
    options.deadline.addEventListener("abort", onExpired, { once: true })
  })
  const attached = await Promise.race([pending, expired]).finally(() =>
    options.deadline.removeEventListener("abort", onExpired),
  )
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

/** The engine's own claim: senpi's inherited descriptor and the framed desktop channel, within the selection's bound. */
export async function claimInheritedDesktopSync(deadline: AbortSignal): Promise<MemorySyncSelection> {
  const { takeInheritedPrivateChannel } = await import("#senpi-private-fds")
  return claimDesktopSync({ take: takeInheritedPrivateChannel, attach: attachDesktopSyncChannel, deadline })
}
