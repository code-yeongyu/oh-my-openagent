import { listLiveDevices, revokeDevice } from "../omo-opencode/src/cli/service-auth/devices"
import type { Session } from "../omo-opencode/src/cli/service-auth/session"
import { sessionFailure, type SessionOutcomeDependencies } from "./account-session-outcome"
import { ACCOUNT_EXIT } from "./account-show"

// `omo account devices` lists the account's live devices; `omo account devices revoke <id>` signs out ANOTHER device of
// the same account by its id (#13189), over the account API's owner-scoped `DELETE /v1/devices/:id`. It is how a dead
// device (state lost, keychain wiped, an old registration of a computer that signed in again) leaves the account: it
// cannot sign itself out. Nothing here picks a device by name or guesses which one is dead: the id is the caller's
// explicit choice, read from the list. This device ends its own sign-in with `omo logout` or `omo account forget`.

export type AccountDevicesDependencies = SessionOutcomeDependencies

const USAGE = "omo account devices: use devices or devices revoke <id>"

const reply = (dependencies: AccountDevicesDependencies, value: unknown, code: number = ACCOUNT_EXIT.ok): number => {
  dependencies.output(JSON.stringify(value))
  return code
}

async function revoke(dependencies: AccountDevicesDependencies, session: Session, id: string): Promise<number> {
  const outcome = await revokeDevice(session, { id, thisDeviceId: (await dependencies.store.read())?.device.id })
  switch (outcome.kind) {
    case "not_found":
      dependencies.error(`omo account devices revoke: no live device ${id} on this account (run omo account devices)`)
      return reply(dependencies, { revoked: false, error: "not_found" }, ACCOUNT_EXIT.failed)
    case "this_device":
      dependencies.error("omo account devices revoke: that is this device; sign it out with omo logout")
      return reply(dependencies, { revoked: false, error: "this_device", device: outcome.device }, ACCOUNT_EXIT.invalid)
    case "still_live":
      dependencies.error(`omo account devices revoke: ${id} is still listed as live after the revoke`)
      return reply(dependencies, { revoked: false, error: "still_live", device: outcome.device }, ACCOUNT_EXIT.failed)
    case "confirmation_mismatch":
      return reply(dependencies, { revoked: false, error: outcome.kind, device: outcome.device }, ACCOUNT_EXIT.invalid)
    case "revoked":
      return reply(dependencies, { revoked: true, device: outcome.device })
  }
}

export async function runDevicesVerb(
  dependencies: AccountDevicesDependencies,
  session: Session,
  flags: readonly string[],
): Promise<number> {
  const [action, id, ...rest] = flags
  if (
    flags.length > 0 &&
    (action !== "revoke" || id === undefined || id === "" || id.startsWith("--") || rest.length > 0)
  ) {
    dependencies.error(USAGE)
    return ACCOUNT_EXIT.invalid
  }
  try {
    if (id === undefined) return reply(dependencies, { devices: await listLiveDevices(session) })
    return await revoke(dependencies, session, id)
  } catch (error) {
    return sessionFailure(dependencies, session, error, "omo account devices: the request failed")
  }
}
