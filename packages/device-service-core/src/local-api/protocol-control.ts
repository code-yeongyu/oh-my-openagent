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
// relay daemon #774: the optional session.attach fields. `seqs: true` keeps `seqs` on this attach's session.records
// whatever the client's version; `resume` (implies seqs) names the last record the client applied, so a replay of that
// attach_id sends only the records after it.
export type AttachResume = { readonly attach_id: number; readonly seq: number };
export type AttachFeatures = { readonly seqs?: true; readonly resume?: AttachResume };
