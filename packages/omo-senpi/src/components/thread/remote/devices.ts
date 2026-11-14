import { threadToolFailure, type ThreadToolFailure } from "../errors"
import type { RemoteDevice, RemoteThreadSurface } from "./ports"

// The ONE device-name resolution (#13432): the thread tools and `omo remote` both turn what a person or an agent typed
// into a device id here. The device table prints a NAME column, so the id, the name and a unique prefix of either all
// name a device; a match two devices give in the same way is ambiguous_device naming each, never a silent pick.

export type DeviceMatch =
  { readonly kind: "ok"; readonly row: RemoteDevice } | { readonly kind: "error"; readonly error: ThreadToolFailure }

const unknown = (typed: string): DeviceMatch => ({
  kind: "error",
  error: threadToolFailure(
    "device_unknown",
    `No device ${typed === "" ? "(empty name)" : typed} is signed in to this account.`,
    "List the account's devices (omo remote devices, or thread_list with all_scope) and name one by its id or name.",
    { device: typed },
  ),
})

const ambiguous = (typed: string, rows: readonly RemoteDevice[]): DeviceMatch => ({
  kind: "error",
  error: threadToolFailure(
    "ambiguous_device",
    `${typed} names ${rows.length} devices: ${rows.map((row) => `${row.label} (${row.device})`).join(", ")}.`,
    "Name one of the candidates by its device id.",
    { device: typed, candidates: rows.map((row) => ({ device: row.device, label: row.label })) },
  ),
})

/**
 * The device `typed` names among `rows`. An exact id names its device unless the same string is another device's
 * name; an exact name names its device unless another device has that name or starts with it; otherwise a prefix of
 * one id or name names that device. Every collision is ambiguous_device listing each candidate. The id is never
 * ambiguous against a prefix: it is the handle ambiguous_device asks for, so it must always resolve.
 */
export function matchDevice(rows: readonly RemoteDevice[], typed: string): DeviceMatch {
  if (typed === "") return unknown(typed)
  const named = rows.filter((row) => row.label === typed)
  const byId = rows.find((row) => row.device === typed)
  if (byId !== undefined) {
    const others = named.filter((row) => row !== byId)
    return others.length === 0 ? { kind: "ok", row: byId } : ambiguous(typed, [byId, ...others])
  }
  const prefixed = rows.filter((row) => row.device.startsWith(typed) || row.label.startsWith(typed))
  const candidates = named.length > 0 ? [...named, ...prefixed.filter((row) => !named.includes(row))] : prefixed
  if (candidates.length === 0) return unknown(typed)
  if (candidates.length === 1 && candidates[0] !== undefined) return { kind: "ok", row: candidates[0] }
  return ambiguous(typed, candidates)
}

export async function resolveDevice(remote: RemoteThreadSurface, typed: string): Promise<DeviceMatch> {
  return matchDevice(await remote.sessions.devices(), typed)
}

/**
 * The surface with the account's device listing read once and shared, for one command: resolving a typed device and
 * checking it online then cost the single listing a verb is allowed (one round trip per call, never a second listing).
 */
export function withOneDeviceListing(remote: RemoteThreadSurface): RemoteThreadSurface {
  let listing: ReturnType<RemoteThreadSurface["sessions"]["devices"]> | undefined
  return { ...remote, sessions: { ...remote.sessions, devices: () => (listing ??= remote.sessions.devices()) } }
}
