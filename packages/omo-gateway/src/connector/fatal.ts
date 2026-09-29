// What the connector host does when an adapter throws AdapterFatal: the platform refused the
// account, so a restart with backoff would only repeat the refusal. The host tells the scope owner
// once, reports `stopped`, and waits; a changed config or credential file builds a fresh adapter.

import { AdapterFatal, type SurfaceAdapter } from "../adapter/contract"
import { connectorName } from "./lock"
import type { PresenceWriter } from "./presence"

export type FatalTarget = {
  platform: string
  account_id: string
  scope: string
  signal: AbortSignal
  createAdapter: () => SurfaceAdapter | Promise<SurfaceAdapter>
  notice?: (text: string) => void
  waitForChange?: (signal: AbortSignal) => Promise<boolean>
}

export type FatalSession = {
  adapter: SurfaceAdapter
  wrap: (created: SurfaceAdapter) => SurfaceAdapter
  fatal: string | null
  presence: PresenceWriter
  log: (line: string) => void
}

const untilAborted = (signal: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => (signal.aborted ? resolve(false) : signal.addEventListener("abort", () => resolve(false), { once: true })))

export async function announceFatal(session: FatalSession, target: FatalTarget, error: AdapterFatal): Promise<void> {
  session.fatal = error.reason
  const name = connectorName(target.platform, target.account_id)
  const notice = target.notice ?? session.log
  notice(
    `gateway connector ${name} (scope ${target.scope}) stopped: ${error.message}. It stays stopped and starts again when the gateway config or the credential file changes.`,
  )
  await session.presence.update({ state: "stopped", last_error: `fatal: ${error.reason}` })
}

/**
 * Stay stopped until the config or credential file changes, then swap in a freshly built adapter.
 * False when the host is shutting down instead. A rebuilt adapter that is refused again starts a
 * new stop with its own notice; any other build error propagates.
 */
export async function stopUntilChanged(session: FatalSession, target: FatalTarget, first: AdapterFatal): Promise<boolean> {
  let current = first
  for (;;) {
    await announceFatal(session, target, current)
    session.log(`not restarting after ${current.platform} refused the account (${current.reason}); waiting for the config or credential file to change`)
    const changed = await (target.waitForChange ?? untilAborted)(target.signal)
    if (!changed || target.signal.aborted) return false
    session.log("the config or credential file changed; starting again")
    try {
      session.adapter = session.wrap(await target.createAdapter())
    } catch (error) {
      if (!(error instanceof AdapterFatal)) throw error
      current = error
      continue
    }
    session.fatal = null
    await session.presence.update({ state: "connecting", last_error: null })
    return true
  }
}
