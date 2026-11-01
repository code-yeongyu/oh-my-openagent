import { SESSION_READ_TAIL_MAX } from "./spec-proto.ts";
import type { CommandStateEvent, EventKind, LocalEvent, RoundDeviceState } from "./protocol.ts";
import {
  bool,
  commandId,
  entryId,
  fail,
  type Fields,
  isRecord,
  jsonObject,
  keysOf,
  localId,
  nullable,
  oneOf,
  safeKey,
  uint,
} from "./validate-fields.ts";
import { deviceId, listingRowOf, readEntryOf, statusOf } from "./validate-shapes.ts";
import {
  attachOf,
  eventFields,
  type EventValidators,
  queryOf,
  STREAM_EVENT_VALIDATORS,
} from "./validate-stream-events.ts";
import {
  COMMAND_REFUSAL_REASONS,
  COMMAND_STATES,
  COMMAND_UNCERTAIN_REASONS,
  RETRYABLE_STATES,
  ROUND_DEVICE_STATES,
  ROUND_STATES,
  UPLOAD_ABORT_REASONS,
} from "./vocabulary.ts";

const revisionOf = (m: Fields): number =>
  uint(m["revision"], 1, Number.MAX_SAFE_INTEGER, "revision");

const devicesOf = (v: unknown): { readonly [device: string]: RoundDeviceState } => {
  if (!isRecord(v)) return fail("round devices");
  const out: Record<string, RoundDeviceState> = {};
  for (const [device, state] of Object.entries(v))
    out[safeKey(deviceId(device), "round device")] = oneOf(
      ROUND_DEVICE_STATES,
      state,
      "round device state",
    );
  return out;
};

// The evidence rule: a reason only for a refusal or an uncertain outcome, retryable exactly for the two states in
// which the recipient provably cannot hold the command.
const commandStateOf = (v: Fields): CommandStateEvent => {
  const m = eventFields(v, ["command_id", "state", "retryable"], ["reason", "receipt"]);
  const state = oneOf(COMMAND_STATES, m["state"], "command state");
  if (bool(m["retryable"], "retryable") !== RETRYABLE_STATES.includes(state))
    return fail("retryable");
  const head = {
    type: "event",
    kind: "session.command_state",
    command_id: commandId(m["command_id"]),
    ...(m["receipt"] === undefined ? {} : { receipt: jsonObject(m["receipt"], "receipt") }),
  } as const;
  const reason = m["reason"];
  switch (state) {
    case "engine_refused":
      return {
        ...head,
        state,
        reason: oneOf(COMMAND_REFUSAL_REASONS, reason, "refusal reason"),
        retryable: false,
      };
    case "uncertain":
      return {
        ...head,
        state,
        reason: oneOf(COMMAND_UNCERTAIN_REASONS, reason, "uncertain reason"),
        retryable: false,
      };
    case "not confirmed":
    case "not delivered: never_sent":
      return reason === undefined ? { ...head, state, retryable: true } : fail("reason");
    case "queued":
    case "transport_confirmed":
    case "engine_dispatched":
    case "engine_applied":
    case "engine_stale":
      return reason === undefined ? { ...head, state, retryable: false } : fail("reason");
  }
};

const VALIDATORS: EventValidators<EventKind> = {
  ...STREAM_EVENT_VALIDATORS,
  "status.changed": (v) => ({
    type: "event",
    kind: "status.changed",
    status: statusOf(eventFields(v, ["status"])["status"]),
  }),
  "sessions.round": (v) => {
    const m = eventFields(v, ["query_id", "state", "devices"]);
    const state = oneOf(ROUND_STATES, m["state"], "round state");
    return {
      type: "event",
      kind: "sessions.round",
      query_id: queryOf(m),
      state,
      devices: devicesOf(m["devices"]),
    };
  },
  "sessions.listing_begin": (v) => {
    const m = eventFields(v, ["query_id", "revision"]);
    return {
      type: "event",
      kind: "sessions.listing_begin",
      query_id: queryOf(m),
      revision: revisionOf(m),
    };
  },
  "sessions.listing_rows": (v) => {
    const m = eventFields(v, ["query_id", "revision", "rows"]);
    const rows = m["rows"];
    if (!Array.isArray(rows) || rows.length === 0) return fail("rows");
    return {
      type: "event",
      kind: "sessions.listing_rows",
      query_id: queryOf(m),
      revision: revisionOf(m),
      rows: rows.map(listingRowOf),
    };
  },
  "sessions.listing_end": (v) => {
    const m = eventFields(v, ["query_id", "revision", "incomplete"]);
    const incomplete = m["incomplete"];
    if (!Array.isArray(incomplete)) return fail("incomplete");
    const devices = incomplete.map((d) => deviceId(d));
    return {
      type: "event",
      kind: "sessions.listing_end",
      query_id: queryOf(m),
      revision: revisionOf(m),
      incomplete: devices,
    };
  },
  "session.command_state": commandStateOf,
  "session.read_result": (v) => {
    const m = eventFields(v, ["attach", "query_id", "entries", "next_before"]);
    const entries = m["entries"];
    if (!Array.isArray(entries) || entries.length > SESSION_READ_TAIL_MAX) return fail("entries");
    const rows = entries.map(readEntryOf);
    if (new Set(rows.map((r) => r.entry_id)).size !== rows.length)
      return fail("duplicate entry_id");
    const next_before = nullable(m["next_before"], (e) => entryId(e, "next_before"));
    return {
      type: "event",
      kind: "session.read_result",
      attach: attachOf(m),
      query_id: queryOf(m),
      entries: rows,
      next_before,
    };
  },
  "session.upload_abort": (v) => {
    const m = eventFields(v, ["upload_id", "reason"]);
    const reason = oneOf(UPLOAD_ABORT_REASONS, m["reason"], "upload abort reason");
    return {
      type: "event",
      kind: "session.upload_abort",
      upload_id: localId(m["upload_id"], "upload_id"),
      reason,
    };
  },
};

export const EVENT_KINDS: readonly EventKind[] = keysOf(VALIDATORS);

export const validateEventFields = (v: Fields): LocalEvent => {
  if (v["type"] !== "event") return fail("an event has type event");
  return VALIDATORS[oneOf(EVENT_KINDS, v["kind"], "event kind")](v);
};
