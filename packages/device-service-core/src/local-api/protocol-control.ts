// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/protocol-control.ts
import type { StatusUpdatePhase } from "./vocabulary.ts";

// #184 D1: the host's attach setting. Local only: served on this device's own local API, never over the relay.
export type ControlAttachGet = { readonly id: string; readonly type: "control.attach.get" };
export type ControlAttachSet = {
  readonly id: string;
  readonly type: "control.attach.set";
  readonly attached: boolean;
};
/** changedAt is the RFC 3339 UTC time of the last set, or "" when the device never stored one (attached). */
export type ControlAttachState = { readonly attached: boolean; readonly changedAt: string };

// #401: the saved remote-commands switch. Local only, like the attach setting.
export type ControlRemoteCommandsGet = {
  readonly id: string;
  readonly type: "control.remote_commands.get";
};
export type ControlRemoteCommandsSet = {
  readonly id: string;
  readonly type: "control.remote_commands.set";
  readonly enabled: boolean;
};
/**
 * enabled is the saved value (true when never set); changedAt is the RFC 3339 UTC time of the last set, or "".
 * overridden: this run started with --no-remote-commands, so remote commands are off until the next run whatever the
 * saved value says; a set still saves.
 */
export type ControlRemoteCommandsState = {
  readonly enabled: boolean;
  readonly changedAt: string;
  readonly overridden: boolean;
};
// #774: the optional session.attach fields. `seqs: true` keeps `seqs` on this attach's session.records whatever the
// client's version; `resume` (implies seqs) names the last record the client applied, so a replay of that attach_id
// sends only the records after it.
export type AttachResume = { readonly attach_id: number; readonly seq: number };
// #896: the newest entry the client holds for the session; the first snapshot the attach gets is trimmed after it.
export type AttachFrom = { readonly last_entry_id: string };
export type AttachFeatures = {
  readonly seqs?: true;
  readonly resume?: AttachResume;
  readonly from?: AttachFrom;
};

// #829 P2 (design B.1): an update candidate in trial. status.get carries `update` while this build is the target of an
// update record; ready says whether the installer may commit it (ready_reason names why not, null when ready).
export type StatusUpdate = {
  readonly update_id: string;
  readonly phase: StatusUpdatePhase;
  readonly target_version: string;
  readonly ready: boolean;
  readonly ready_reason: string | null;
};
// The installer, and only it, commits the candidate it verified ready: the candidate then takes new work.
// omo#13037 A7.2.1: the saved wake switch. Local only, owner clients only, like the two settings above.
export type ControlSessionWakeGet = {
  readonly id: string;
  readonly type: "control.session_wake.get";
};
export type ControlSessionWakeSet = {
  readonly id: string;
  readonly type: "control.session_wake.set";
  /** null removes the stored value, so the build default applies. */
  readonly enabled: boolean | null;
};
/**
 * enabled is the effective value; stored is the stored value (null: nothing stored, the build default applies;
 * "unreadable": a stored value that does not parse, or a failed read, which reads off until a set repairs it);
 * overridden: this run cannot list the feature whatever the switch says (started without remote commands).
 */
export type ControlSessionWakeState = {
  readonly enabled: boolean;
  readonly stored: boolean | null | "unreadable";
  readonly changedAt: string;
  readonly overridden: boolean;
};
export type UpdateCommitted = {
  readonly id: string;
  readonly type: "owner.update_committed";
  readonly update_id: string;
};
export type ControlRequest =
  | ControlAttachGet
  | ControlAttachSet
  | ControlRemoteCommandsGet
  | ControlRemoteCommandsSet
  | ControlSessionWakeGet
  | ControlSessionWakeSet
  | UpdateCommitted;
export type ControlResponseData = {
  readonly "control.attach.get": ControlAttachState;
  readonly "control.attach.set": ControlAttachState;
  readonly "control.remote_commands.get": ControlRemoteCommandsState;
  readonly "control.remote_commands.set": ControlRemoteCommandsState;
  readonly "control.session_wake.get": ControlSessionWakeState;
  readonly "control.session_wake.set": ControlSessionWakeState;
  readonly "owner.update_committed": { readonly [key: string]: never };
};
