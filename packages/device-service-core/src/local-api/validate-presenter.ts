// Vendored from sisyphuslabs/omo-relay-daemon@08905c110bb10ab2ba725ff8b8c642a64fbd1652 packages/local-api/src/validate-presenter.ts
import { fromBase64url, toBase64url } from "./bytes-encoding.ts";
import {
  PRESENTER_ENDED_REASONS,
  PRESENTER_LOCAL_LANES,
  PRESENTER_LOCAL_LINE_MAX,
  type PresenterFrameEvent,
  type PresenterLocalLane,
} from "./protocol-presenter.ts";
import { fail, oneOf, type Fields } from "./validate-fields.ts";
import type { RequestValidators } from "./validate-command.ts";
import { requestFields } from "./validate-command.ts";
import { deviceId, sessionId } from "./validate-shapes.ts";
import { eventFields, type EventValidators } from "./validate-stream-events.ts";

// Decision 0020 on the local API (protocol-presenter.ts). A line's base64url text is bounded by its lane's own cap
// BEFORE it is decoded (gate r1 F10), and must decode to 1.. that many bytes and re-encode to the same text; the
// newline rule and the delegated-lane allowlist are relayd's, after decoding, so a bad line is a local error and never
// ends the client's tunnel.
const BASE64URL = /^[A-Za-z0-9_-]+$/;
export const presenterLineText = (v: unknown, lane: PresenterLocalLane): string => {
  const max = PRESENTER_LOCAL_LINE_MAX[lane];
  if (typeof v !== "string" || v.length === 0 || v.length > Math.ceil((max * 4) / 3))
    return fail("line too long");
  if (!BASE64URL.test(v)) return fail("line");
  let bytes: Uint8Array;
  try {
    bytes = fromBase64url(v);
  } catch (error) {
    if (error instanceof Error) return fail("line");
    throw error;
  }
  return bytes.length <= max && toBase64url(bytes) === v ? v : fail("line");
};
const laneOf = (v: Fields): PresenterLocalLane => oneOf(PRESENTER_LOCAL_LANES, v["lane"], "lane");

export const PRESENTER_REQUEST_VALIDATORS: RequestValidators<
  "session.presenter_open" | "session.presenter_send"
> = {
  "session.presenter_open": (v, id) => {
    const m = requestFields(v, ["device", "session"]);
    return {
      id,
      type: "session.presenter_open",
      device: deviceId(m["device"]),
      session: sessionId(m["session"]),
    };
  },
  "session.presenter_send": (v, id) => {
    const m = requestFields(v, ["device", "lane", "b"]);
    const lane = laneOf(m);
    return {
      id,
      type: "session.presenter_send",
      device: deviceId(m["device"]),
      lane,
      b: presenterLineText(m["b"], lane),
    };
  },
};

const frameOf = (v: Fields): PresenterFrameEvent => {
  const m = eventFields(v, ["device", "lane", "b"]);
  const lane = laneOf(m);
  return {
    type: "event",
    kind: "session.presenter_frame",
    device: deviceId(m["device"]),
    lane,
    b: presenterLineText(m["b"], lane),
  };
};
export const PRESENTER_EVENT_VALIDATORS: EventValidators<
  "session.presenter_frame" | "session.presenter_ended"
> = {
  "session.presenter_frame": frameOf,
  "session.presenter_ended": (v) => {
    const m = eventFields(v, ["device", "reason"]);
    return {
      type: "event",
      kind: "session.presenter_ended",
      device: deviceId(m["device"]),
      reason: oneOf(PRESENTER_ENDED_REASONS, m["reason"], "presenter end reason"),
    };
  },
};
