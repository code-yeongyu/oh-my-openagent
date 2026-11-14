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

/** The device `typed` names among `rows`: its id, else its name, else a unique prefix of an id or a name. */
export function matchDevice(rows: readonly RemoteDevice[], typed: string): DeviceMatch {
  if (typed === "") return unknown(typed)
  const byId = rows.find((row) => row.device === typed)
  if (byId !== undefined) return { kind: "ok", row: byId }
  for (const tier of [
    rows.filter((row) => row.label === typed),
    rows.filter((row) => row.device.startsWith(typed) || row.label.startsWith(typed)),
  ]) {
    if (tier.length === 1 && tier[0] !== undefined) return { kind: "ok", row: tier[0] }
    if (tier.length > 1) return ambiguous(typed, tier)
  }
  return unknown(typed)
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
  const sessions: RemoteThreadSurface["sessions"] = Object.create(remote.sessions)
  Object.defineProperty(sessions, "devices", {
    value: () => (listing ??= remote.sessions.devices()),
  })
  return { ...remote, sessions }
}
