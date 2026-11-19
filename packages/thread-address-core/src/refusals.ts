/** The refusal codes an address resolution answers (design section 5); they are omo's thread error codes. */
export type RefusalCode =
  | "invalid_arguments"
  | "caller_context_missing"
  | "not_found"
  | "ambiguous_target"
  | "device_offline"
  | "host_unavailable"
  | "scope_denied"

/** A device as a refusal lists it. */
export type DeviceCandidate = { readonly device: string; readonly name: string; readonly online: boolean }

/** The one thread candidate shape: `address` resolves as written; `device` is the id, `device_name` its name. */
export type ThreadCandidate = {
  readonly thread: string
  readonly address: string
  readonly name: string
  readonly cwd: string
  readonly state: string
  readonly updatedAt: string | null
  readonly device?: string
  readonly device_name?: string
}

/** A device row as the roster names it. */
export type DeviceRow = {
  readonly id: string
  readonly name: string
  readonly online: boolean
  readonly last_seen_ms?: number | null
}

/**
 * Every typed refusal as plain data: its code, a `reason` naming the condition, and the `details` a caller reads. The
 * caller words the message (it knows its own tool names); `typed` is the text the caller passed, when it names a device.
 */
export type AddressRefusal =
  | {
      readonly code: "not_found"
      readonly reason: "no_device"
      readonly typed: string
      readonly details: { readonly kind: "device"; readonly device: string; readonly candidates: readonly DeviceCandidate[] }
    }
  | {
      readonly code: "ambiguous_target"
      readonly reason: "devices_share_name" | "devices_share_prefix"
      readonly typed: string
      readonly details: { readonly kind: "device"; readonly device: string; readonly candidates: readonly DeviceCandidate[] }
    }
  | {
      readonly code: "device_offline"
      readonly reason: "device_offline"
      readonly typed: string
      readonly details: {
        readonly device: string
        readonly device_name: string
        readonly last_seen: number | null
        readonly candidates: readonly DeviceCandidate[]
      }
    }
  | {
      readonly code: "host_unavailable"
      readonly reason: "listing_incomplete" | "device_unanswered"
      readonly details: {
        readonly reason: "listing_incomplete" | "device_unanswered"
        readonly devices: readonly string[]
        readonly device_names: readonly string[]
      }
    }
  | {
      readonly code: "host_unavailable"
      readonly reason: "probe_unavailable"
      readonly details: {
        readonly reason: "probe_unavailable"
        readonly thread: string
        readonly device: string
        readonly device_name: string
      }
    }
  | {
      readonly code: "not_found"
      readonly reason: "no_thread_on_device"
      readonly details: { readonly kind: "thread"; readonly thread: string; readonly device: string; readonly device_name: string }
    }

const CANDIDATE_LIMIT = 10

export const deviceCandidates = (rows: readonly DeviceRow[]): readonly DeviceCandidate[] =>
  rows.slice(0, CANDIDATE_LIMIT).map((row) => ({ device: row.id, name: row.name, online: row.online }))

/** A device as every message names it: `name (id)`, or the id alone when its name is empty or the id itself. */
export const deviceLabel = (device: { readonly id: string; readonly name: string }): string =>
  device.name === "" || device.name === device.id ? device.id : `${device.name} (${device.id})`

export const noDevice = (typed: string, devices: readonly DeviceRow[]): AddressRefusal => ({
  code: "not_found",
  reason: "no_device",
  typed,
  details: { kind: "device", device: typed, candidates: deviceCandidates(devices) },
})

export const devicesShare = (
  by: "devices_share_name" | "devices_share_prefix",
  typed: string,
  matches: readonly DeviceRow[],
): AddressRefusal => ({
  code: "ambiguous_target",
  reason: by,
  typed,
  details: { kind: "device", device: typed, candidates: deviceCandidates(matches) },
})

export const deviceOffline = (typed: string, device: DeviceRow, matched: readonly DeviceRow[]): AddressRefusal => ({
  code: "device_offline",
  reason: "device_offline",
  typed,
  details: {
    device: device.id,
    device_name: device.name,
    last_seen: device.last_seen_ms ?? null,
    candidates: deviceCandidates(matched),
  },
})

export const devicesSilent = (
  reason: "listing_incomplete" | "device_unanswered",
  devices: readonly { readonly id: string; readonly name: string }[],
): AddressRefusal => ({
  code: "host_unavailable",
  reason,
  details: { reason, devices: devices.map((device) => device.id), device_names: devices.map((device) => device.name) },
})

export const probeUnavailable = (thread: string, device: { readonly id: string; readonly name: string }): AddressRefusal => ({
  code: "host_unavailable",
  reason: "probe_unavailable",
  details: { reason: "probe_unavailable", thread, device: device.id, device_name: device.name },
})

export const noThreadOnDevice = (thread: string, device: { readonly id: string; readonly name: string }): AddressRefusal => ({
  code: "not_found",
  reason: "no_thread_on_device",
  details: { kind: "thread", thread, device: device.id, device_name: device.name },
})
