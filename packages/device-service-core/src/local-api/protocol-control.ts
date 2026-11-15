// The host's attach setting: whether this account's other devices may view and command this device's sessions.
// Local only: served on this device's own local API to the desktop and the CLI, never over the transport.
export type ControlAttachGet = { readonly id: string; readonly type: "control.attach.get" }
export type ControlAttachSet = {
  readonly id: string
  readonly type: "control.attach.set"
  readonly attached: boolean
}
// omo#13037 A7.2.1: the wake switch - whether sessions on this device that are not running may be started by a message
// from another of the account's devices. Local only, like the attach setting; never over the transport.
export type ControlSessionWakeGet = { readonly id: string; readonly type: "control.session_wake.get" }
export type ControlSessionWakeSet = {
  readonly id: string
  readonly type: "control.session_wake.set"
  /** null removes the stored value, so the device follows the build default. */
  readonly enabled: boolean | null
}
/**
 * `stored` is what the device has: true, false, null (nothing stored, so the build default) or "unreadable" (a stored
 * value that does not parse, or a failed read; a set repairs it). `overridden` is true when this run of the service
 * cannot list the feature whatever the switch says.
 */
export type ControlSessionWakeState = {
  readonly enabled: boolean
  readonly stored: boolean | null | "unreadable"
  readonly changedAt: string
  readonly overridden: boolean
}

/** changedAt is the RFC 3339 UTC time of the last set, or "" when the device never stored one (attached). */
export type ControlAttachState = { readonly attached: boolean; readonly changedAt: string }
