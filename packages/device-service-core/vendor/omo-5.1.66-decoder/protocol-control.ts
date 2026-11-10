// The host's attach setting: whether this account's other devices may view and command this device's sessions.
// Local only: served on this device's own local API to the desktop and the CLI, never over the transport.
export type ControlAttachGet = { readonly id: string; readonly type: "control.attach.get" };
export type ControlAttachSet = {
  readonly id: string;
  readonly type: "control.attach.set";
  readonly attached: boolean;
};
/** changedAt is the RFC 3339 UTC time of the last set, or "" when the device never stored one (attached). */
export type ControlAttachState = { readonly attached: boolean; readonly changedAt: string };
