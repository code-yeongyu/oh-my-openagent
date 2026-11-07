// A declared launch's claim of the inherited memory-sync channel (account-transport-api v11 section 7.3): take it once,
// attach within the bootstrap bound, and close an attachment that connects after the answer. It ships in the
// device-account sidecar; hostSelection.ts in omo.js only classifies the launch and memoizes the selection.

import type { Duplex } from "node:stream"
import { takeInheritedPrivateChannel } from "#senpi-private-fds"
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
  const taken = options.take(MEMORY_SYNC_CHANNEL)
  // SCRATCH DIAGNOSTICS (memsync-coord/diag-12704-win): which stream the claim got.
  process.stderr.write(`omo-boot-diag pid=${process.pid} take ${JSON.stringify({ name: MEMORY_SYNC_CHANNEL, stream: taken === undefined ? "undefined" : taken.constructor?.name ?? typeof taken, readable: taken?.readable ?? null, writable: taken?.writable ?? null })}\n`)
  const pending = options.attach(taken)
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<"expired">(resolve => { timer = setTimeout(() => resolve("expired"), options.attachDeadlineMs ?? 10_000) })
  const attached = await Promise.race([pending, expired]).finally(() => clearTimeout(timer))
  process.stderr.write(`omo-boot-diag pid=${process.pid} claim-attach-outcome ${JSON.stringify(attached === "expired" ? { outcome: "expired" } : { outcome: attached.kind, reason: attached.kind === "unavailable" ? attached.reason : null })}\n`)
  if (attached === "expired") {
    // A late attachment is discarded: close it so the claimed channel cannot outlive the unavailable answer.
    void pending.then(late => { if (late.kind === "connected") late.channel.close() }, () => undefined)
    return { kind: "unavailable", reason: "private_channel_unavailable" }
  }
  return attached.kind === "connected" ? { kind: "desktop", channel: attached.channel } : attached
}

/** The engine's own claim: senpi's inherited descriptor and the framed desktop channel. */
export function claimInheritedDesktopSync(): Promise<MemorySyncSelection> {
  return claimDesktopSync({ take: takeInheritedPrivateChannel, attach: attachDesktopSyncChannel })
}
