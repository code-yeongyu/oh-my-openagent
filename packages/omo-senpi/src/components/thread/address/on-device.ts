import {
  devicesSilent,
  idShaped,
  noThreadOnDevice,
  sameSession,
  THREAD_ID_SHAPE,
  type DeviceRef,
} from "@oh-my-opencode/thread-address-core"
import { namedDeviceRow, relayAddressEntry } from "../remote/address-book"
import type { RemoteThreadSurface } from "../remote/ports"
import { holderTarget } from "../remote/remote-ops"
import type { Account } from "./account"
import { deviceNameOf } from "./bare"
import { ladder } from "./ladder"
import { pinned } from "./probe"
import { toolRefusal, withAddresses, type ThreadRefusal } from "./refusals"
import type { Found, ResolveContext, ResolveOptions } from "./types"

async function aliasOn(
  remote: RemoteThreadSurface,
  account: Account,
  device: string,
  alias: string,
): Promise<Found | undefined> {
  if (remote.aliases === undefined) return undefined
  const held = await remote.aliases.resolve(alias).catch(() => undefined)
  if (held === undefined || held.kind === "error" || held.value.device !== device) return undefined
  const holder = await holderTarget(remote, held.value, account.here, account.rows, account.roster)
  return "where" in holder && holder.where === "remote"
    ? { kind: "ok", entry: relayAddressEntry(holder.row, [alias]), resolution: "alias", all_scope: true }
    : undefined
}

/**
 * The thread part of `<device>/<thread>` among that device's threads only (design section 3). This device: its own
 * book, workspace scope as for a bare address. Another device: its listing rows; a thread id is answered by the device
 * itself when no row lists it yet (a session opened a moment ago, #12709). A miss on a device that did not answer this
 * round is host_unavailable, never not_found.
 */
export async function resolveOnDevice(
  ctx: ResolveContext,
  remote: RemoteThreadSurface,
  account: Account,
  device: DeviceRef,
  thread: string,
  opts: ResolveOptions,
): Promise<Found | ThreadRefusal> {
  const names = deviceNameOf(account)
  if (device.here) {
    const hit = ladder(ctx, ctx.local, thread, opts)
    return hit.kind === "ok" ? { ...hit, all_scope: opts.all_scope } : withAddresses(hit, account.here, names)
  }
  const rows = account.rows.filter((row) => row.device === device.id)
  const entries = rows.map((row) => relayAddressEntry(row))
  if (THREAD_ID_SHAPE.test(thread)) {
    const listed = rows.find((row) =>
      sameSession({ device: device.id, thread }, { device: row.device, thread: row.durable_id, key: row.session_id }),
    )
    // Not listed: that one device is asked, as a pinned reply asks it (design section 3 step 8, review H1).
    if (listed === undefined) return await pinned(remote, { device: device.id, thread })
    return { kind: "ok", entry: relayAddressEntry(listed), resolution: "id", all_scope: true }
  }
  const hit = ladder(ctx, entries, thread, { ...opts, all_scope: true })
  if (hit.kind === "ok") return { ...hit, all_scope: true }
  if (hit.code === "ambiguous_target") return withAddresses(hit, account.here, names)
  const alias = await aliasOn(remote, account, device.id, thread)
  if (alias !== undefined) return alias
  // A routing id or listing key the device has not listed yet (#13748: a session opened a moment ago) is the only text
  // passed through to the device unresolved.
  if (idShaped(thread)) {
    const { durable_id: _unknown, ...row } = namedDeviceRow(device.id, thread)
    return { kind: "ok", entry: relayAddressEntry(row), resolution: "session_id", all_scope: true }
  }
  if (device.listing === "incomplete") return toolRefusal(devicesSilent("listing_incomplete", [device]))
  return toolRefusal(noThreadOnDevice(thread, device))
}
