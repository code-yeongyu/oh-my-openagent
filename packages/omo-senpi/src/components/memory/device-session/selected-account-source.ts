// The one account source of this thread (account-transport-api v9 section 7.3), built from the engine's single
// memory-sync selection. A desktop host gets the desktop source or an unavailable one, never the CLI credential source;
// only a CLI selection ever constructs it.

import { openDesktopSyncAccount, type DesktopSyncEngineWire } from "../desktop-sync/desktopSyncAccount"
import type { MemorySyncSelection } from "../desktop-sync/hostSelection"
import { DesktopSyncRefused } from "../desktop-sync/desktopSyncProtocol"
import type { DesktopSyncAccount, DeviceAccount, DeviceAccountSource, DesktopSyncUnavailable } from "./account-source"

export function accountSourceFromSelection(options: {
  readonly selection: () => Promise<MemorySyncSelection>
  readonly cli: () => DeviceAccountSource
  readonly openAccount?: (wire: DesktopSyncEngineWire) => Promise<DesktopSyncAccount>
}): DeviceAccountSource {
  const open = options.openAccount ?? openDesktopSyncAccount
  let selected: Promise<MemorySyncSelection> | undefined
  let cliSource: DeviceAccountSource | undefined
  let current: DesktopSyncAccount | undefined
  const unavailable = (reason: DesktopSyncUnavailable["reason"]): DesktopSyncUnavailable => ({ kind: "unavailable", reason })
  return async (): Promise<DeviceAccount | null> => {
    selected ??= options.selection()
    const selection = await selected
    if (selection.kind === "cli") {
      cliSource ??= options.cli()
      return cliSource()
    }
    if (selection.kind === "unavailable") return unavailable(selection.reason)
    const channel = selection.channel
    if (channel.signal.aborted) return unavailable("private_channel_unavailable")
    if (current !== undefined && await current.isCurrent()) return current
    current = undefined
    try {
      current = await open(channel)
      return current
    } catch (error) {
      if (channel.signal.aborted) return unavailable("private_channel_unavailable")
      // Main has no account to describe (signed out, or retired mid-capture): signed out until the next resolve.
      if (error instanceof DesktopSyncRefused) return null
      throw error
    }
  }
}
