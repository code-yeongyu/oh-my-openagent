// Vendored from sisyphuslabs/omo-relay-daemon@08905c110bb10ab2ba725ff8b8c642a64fbd1652 packages/local-api/src/protocol-presenter.ts
import type { Empty, EventOf } from "./protocol.ts";

// Decision 0020 on the local API v1: the remote presenter tunnel. A client that owns a delegated channel toward a
// device (protocol-delegated.ts) opens one tunnel on it for a session that device lists; the answer comes once the
// host confirmed the open (or refused it). Lines go both ways as base64url of their exact bytes, one JSONL record each
// without its newline, on lane `control` (the engine's presenter control endpoint, opaque) or `delegated` (the private
// form records on the client's own delegated engine connection). A tunnel's frames reach only the connection that
// opened it; session.presenter_ended ends it for good, and a new one needs a new delegated channel.
export const PRESENTER_LOCAL_LANES = ["control", "delegated"] as const;
export type PresenterLocalLane = (typeof PRESENTER_LOCAL_LANES)[number];
// The relay-spec values this API names, kept here so the bundled client carries no wire protocol (the bundle aliases
// relay-spec/proto to a narrow shim); test/vocabulary-drift.test.ts holds them equal to the vendored spec.
export const PRESENTER_LOCAL_LINE_MAX: Readonly<Record<PresenterLocalLane, number>> = {
  control: 16 * 1024,
  delegated: 1024 * 1024,
};
export const PRESENTER_ENDED_REASONS = [
  "viewer_closed",
  "engine_closed",
  "no_control_endpoint",
  "no_delegated_connection",
  "not_granted",
  "conn_collision",
  "busy",
  "idle",
  "event_lost",
  "too_large",
  "malformed",
  "rate",
] as const;
export type PresenterEndedReason = (typeof PRESENTER_ENDED_REASONS)[number];
export type SessionPresenterOpen = {
  readonly id: string;
  readonly type: "session.presenter_open";
  readonly device: string;
  readonly session: string;
};
export type SessionPresenterSend = {
  readonly id: string;
  readonly type: "session.presenter_send";
  readonly device: string;
  readonly lane: PresenterLocalLane;
  readonly b: string;
};
export type PresenterRequest = SessionPresenterOpen | SessionPresenterSend;
export type PresenterResponseData = {
  readonly "session.presenter_open": Empty;
  readonly "session.presenter_send": Empty;
};
export type PresenterFrameEvent = EventOf<
  "session.presenter_frame",
  { readonly device: string; readonly lane: PresenterLocalLane; readonly b: string }
>;
export type PresenterEndedEvent = EventOf<
  "session.presenter_ended",
  { readonly device: string; readonly reason: PresenterEndedReason }
>;
export type PresenterEvent = PresenterFrameEvent | PresenterEndedEvent;
