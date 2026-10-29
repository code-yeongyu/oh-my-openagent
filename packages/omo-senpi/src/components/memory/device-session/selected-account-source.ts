// Memory registration selects one account source once (account-transport-api v8 section 7). A launch that declares
// the `memory-sync` private channel is a desktop host: it gets the desktop source or an unavailable one, never the CLI
// credential source. Only an undeclared launch is a standalone CLI.

import type { Duplex } from "node:stream"
import { openDesktopSyncAccount, type DesktopSyncEngineWire } from "../desktop-sync/desktopSyncAccount"
import { DesktopSyncRefused } from "../desktop-sync/desktopSyncProtocol"
import type { DesktopSyncAccount, DeviceAccount, DeviceAccountSource, DesktopSyncUnavailable } from "./account-source"

export const MEMORY_SYNC_CHANNEL = "memory-sync"

export interface InheritedPrivateChannels {
  declared(name: string): boolean
  take(name: string): Duplex | undefined
}

export type DesktopSyncAttachment =
  | { readonly kind: "connected"; readonly channel: DesktopSyncEngineWire }
  | { readonly kind: "unavailable"; readonly reason: DesktopSyncUnavailable["reason"] }

export function selectDeviceAccountSource(options: {
  readonly inherited: InheritedPrivateChannels
  readonly attach: (stream: Duplex | undefined) => Promise<DesktopSyncAttachment>
  readonly cli: () => DeviceAccountSource
  readonly openAccount?: (wire: DesktopSyncEngineWire) => Promise<DesktopSyncAccount>
}): DeviceAccountSource {
  if (!options.inherited.declared(MEMORY_SYNC_CHANNEL)) return options.cli()
  const open = options.openAccount ?? openDesktopSyncAccount
  const attachment = options.attach(options.inherited.take(MEMORY_SYNC_CHANNEL))
  let current: DesktopSyncAccount | undefined
  const unavailable = (reason: DesktopSyncUnavailable["reason"]): DesktopSyncUnavailable => ({ kind: "unavailable", reason })
  return async (): Promise<DeviceAccount | null> => {
    const attached = await attachment
    if (attached.kind === "unavailable") return unavailable(attached.reason)
    const channel = attached.channel
    if (channel.signal.aborted) return unavailable("private_channel_unavailable")
    if (current !== undefined && await current.isCurrent()) return current
    current = undefined
    try {
      current = await open(channel)
      return current
    } catch (error) {
      // Main has no account to describe (signed out, or retired mid-capture): signed out until the next resolve.
      if (error instanceof DesktopSyncRefused && !channel.signal.aborted) return null
      if (channel.signal.aborted) return unavailable("private_channel_unavailable")
      throw error
    }
  }
}
