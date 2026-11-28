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
  // Concurrent resolves with no current account share one open, so the channel sees one descriptor request (#12799).
  let opening: Promise<DesktopSyncAccount> | undefined
  const unavailable = (reason: DesktopSyncUnavailable["reason"]): DesktopSyncUnavailable => ({
    kind: "unavailable",
    reason,
  })
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
    const seen = current
    if (seen !== undefined && (await seen.isCurrent())) return seen
    // A resolve that overlapped this check may already have stored a fresh account: that one is the answer, and it
    // is never overwritten by this caller's verdict on the account it saw (#12804).
    if (current !== seen) {
      if (current !== undefined) return current
    } else current = undefined
    try {
      // The account is stored by the open itself, before `opening` clears, so no resolve ever finds neither set
      // and opens a second time while the first open's waiters are still resuming (#12804).
      opening ??= open(channel)
        .then((account) => {
          current = account
          return account
        })
        .finally(() => {
          opening = undefined
        })
      return await opening
    } catch (error) {
      if (channel.signal.aborted) return unavailable("private_channel_unavailable")
      // Main has no account to describe (signed out, or retired mid-capture): signed out until the next resolve.
      if (error instanceof DesktopSyncRefused) return null
      throw error
    }
  }
}
