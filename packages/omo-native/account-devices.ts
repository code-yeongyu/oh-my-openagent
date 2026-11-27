import { syncRequestHeaders } from "../memory-core/src/sync/contract-version"
import { type LiveDevice, listLiveDevices } from "../omo-opencode/src/cli/service-auth/devices"
import { ApiRefusal } from "../omo-opencode/src/cli/service-auth/protocol"
import type { Session } from "../omo-opencode/src/cli/service-auth/session"
import { resolveDevice, type DeviceRow } from "../thread-address-core/src/index"
import { sessionFailure, type SessionOutcomeDependencies } from "./account-session-outcome"
import { ACCOUNT_EXIT } from "./account-show"

// `omo account devices` lists the account's live devices; `omo account devices revoke <id>` signs out ANOTHER device of
// the same account (#13189), over the account API's owner-scoped `DELETE /v1/devices/:id`. It is how a dead device
// (state lost, keychain wiped, an old registration of a computer that signed in again) leaves the account: it cannot
// sign itself out. The id is the caller's explicit choice from the list; a NAME or a unique id PREFIX names the same
// row through the shared device resolver (#14305), and because a revoke destroys the device, an ambiguity (two rows
// answering one name or prefix) revokes nothing and names both. This device ends its own sign-in with `omo logout` or
// `omo account forget`.

export type AccountDevicesDependencies = SessionOutcomeDependencies

const USAGE = "omo account devices: use devices or devices revoke <id>"

const reply = (dependencies: AccountDevicesDependencies, value: unknown, code: number = ACCOUNT_EXIT.ok): number => {
  dependencies.output(JSON.stringify(value))
  return code
}

// The account's rows as the core's roster: a revoke reaches a device whatever its last-seen time (a dead device is
// exactly what leaves), so every row reads online to the resolver.
const deviceRows = (rows: readonly LiveDevice[]): readonly DeviceRow[] =>
  rows.map((row) => ({ id: row.id, name: row.name, online: true }))

async function revoke(dependencies: AccountDevicesDependencies, session: Session, id: string): Promise<number> {
  const before = await listLiveDevices(session)
  const stored = (await dependencies.store.read())?.device.id ?? null
  const here = before.find((row) => row.current)?.id ?? stored
  const resolved = resolveDevice({ here, devices: deviceRows(before) }, id, { online: false })
  if (resolved.kind === "refusal") {
    const { refusal } = resolved
    // With every row online the resolver refuses only an unknown device or one name or prefix several devices share.
    if (refusal.reason !== "devices_share_name" && refusal.reason !== "devices_share_prefix") {
      dependencies.error(`omo account devices revoke: no live device ${id} on this account (run omo account devices)`)
      return reply(dependencies, { revoked: false, error: "not_found" }, ACCOUNT_EXIT.failed)
    }
    const { candidates } = refusal.details
    dependencies.error(
      refusal.reason === "devices_share_name"
        ? `omo account devices revoke: ${candidates.length} live devices are named ${id}; pass one device id:`
        : `omo account devices revoke: ${candidates.length} live device ids start with ${id}; pass one full id:`,
    )
    for (const candidate of candidates) dependencies.error(`  ${candidate.device}  ${candidate.name}`)
    const ids = candidates.map((candidate) => candidate.device)
    return reply(dependencies, { revoked: false, error: "ambiguous_target", candidates: ids }, ACCOUNT_EXIT.failed)
  }
  const target = before.find((row) => row.id === resolved.device.id)
  if (target === undefined) {
    dependencies.error(`omo account devices revoke: no live device ${id} on this account (run omo account devices)`)
    return reply(dependencies, { revoked: false, error: "not_found" }, ACCOUNT_EXIT.failed)
  }
  // The stored credential decides too: a service that omits or misreports `current` never gets this device revoked.
  if (target.current || target.id === stored) {
    dependencies.error("omo account devices revoke: that is this device; sign it out with omo logout")
    return reply(dependencies, { revoked: false, error: "this_device", device: target }, ACCOUNT_EXIT.invalid)
  }
  const access = await session.accessToken()
  try {
    await session.request(`/v1/devices/${encodeURIComponent(target.id)}`, {
      method: "DELETE",
      headers: syncRequestHeaders(access),
    })
  } catch (error) {
    // Another caller revoked it between the list and the delete: the account answers 404 for a device it no longer has.
    if (!(error instanceof ApiRefusal && error.status === 404)) throw error
  }
  // Read back: the revoke counts only once the account no longer lists the device as live.
  const after = await listLiveDevices(session)
  if (after.some((device) => device.id === target.id)) {
    dependencies.error(`omo account devices revoke: ${target.id} is still listed as live after the revoke`)
    return reply(dependencies, { revoked: false, error: "still_live", device: target }, ACCOUNT_EXIT.failed)
  }
  return reply(dependencies, { revoked: true, device: target })
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
