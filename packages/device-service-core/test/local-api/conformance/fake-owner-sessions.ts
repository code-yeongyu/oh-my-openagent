import { blobEvents, LOCAL_INLINE_MAX, lineBytes, sha256Hex } from "../../../src/local-api/chunking.ts";
import { pageListing } from "../../../src/local-api/listing.ts";
import type {
  CommandRequest,
  JsonObject,
  ListingRow,
  SessionAttach,
  SessionCommand,
  SessionCommandPart,
  SessionDetach,
  SessionFilter,
  SessionRead,
  SessionsList,
} from "../../../src/local-api/protocol.ts";
import { checkCommandText, MESSAGE_LIMIT_CHARS } from "../../../src/local-api/upload.ts";
import { assertNever } from "../../../src/local-api/validate-fields.ts";
import { readPage } from "./fake-owner-history.ts";
import {
  type Conn,
  eventOf,
  ok,
  type Outcome,
  type OwnerState,
  refuse,
  utf8,
} from "./fake-owner-state.ts";
import type { WorldSession } from "./world.ts";

type SessionRequest =
  | SessionsList
  | SessionAttach
  | SessionDetach
  | SessionCommand
  | SessionCommandPart
  | SessionRead;

const tooLong = (): Outcome =>
  refuse("message_too_long", "the text is over the limit", { limit_chars: MESSAGE_LIMIT_CHARS });

const matches = (row: ListingRow, filter: SessionFilter | undefined): boolean =>
  (filter?.device === undefined || row.device === filter.device) &&
  (filter?.project === undefined || row.project === filter.project) &&
  (filter?.state === undefined || row.state === filter.state);

const list = (state: OwnerState, conn: Conn, request: SessionsList): Outcome => {
  const query_id = state.mint();
  const { revisions, devices } = state.world.listing;
  const pending = Object.fromEntries(Object.keys(devices).map((d) => [d, "pending"]));
  return ok({ query_id }, () => {
    conn.send(eventOf("sessions.round", { query_id, state: "open", devices: pending }));
    revisions.forEach((revision, i) => {
      const rows = revision.rows.filter((r) => matches(r, request.filter));
      const head = { query_id, revision: i + 1, incomplete: revision.incomplete };
      for (const event of pageListing(rows, LOCAL_INLINE_MAX, head)) conn.send(event);
    });
    conn.send(eventOf("sessions.round", { query_id, state: "done", devices }));
  });
};

const sendRecords = (
  conn: Conn,
  attach: string,
  session: WorldSession,
  mint: () => string,
): void => {
  const attach_id = session.snapshot.attach_id;
  let batch: JsonObject[] = [];
  const flush = (): void => {
    if (batch.length > 0)
      conn.send(eventOf("session.records", { attach, attach_id, records: batch }));
    batch = [];
  };
  session.records.forEach((record, i) => {
    if (
      lineBytes(eventOf("session.records", { attach, attach_id, records: [record] })) >
      LOCAL_INLINE_MAX
    ) {
      flush();
      const target = { of: "record", position: { attach_id, seq: i + 1 } } as const;
      for (const event of blobEvents(attach, mint(), target, utf8(JSON.stringify(record))))
        conn.send(event);
      return;
    }
    const grown = eventOf("session.records", { attach, attach_id, records: [...batch, record] });
    if (lineBytes(grown) > LOCAL_INLINE_MAX) flush();
    batch.push(record);
  });
  flush();
};

const attachTo = (state: OwnerState, conn: Conn, request: SessionAttach): Outcome => {
  if (!state.world.devices.some((d) => d.device === request.device))
    return refuse("peer_not_found", "no such device in the account");
  const session = state.world.sessions.find(
    (s) => s.device === request.device && s.session_id === request.session_id,
  );
  if (session === undefined) return refuse("session_not_found", "no such session on that device");
  const attach = state.mint();
  state.attaches.set(attach, session);
  conn.attaches.add(attach);
  return ok({ attach }, () => {
    if (session.attach_pending === true)
      conn.send(eventOf("session.attach_pending", { attach, reason: "stream_key_pending" }));
    const inline = eventOf("session.snapshot", { attach, ...session.snapshot });
    if (lineBytes(inline) <= LOCAL_INLINE_MAX) conn.send(inline);
    else {
      const blob = state.mint();
      conn.send(eventOf("session.snapshot_loading", { attach, blob }));
      const target = { of: "state", position: { attach_id: session.snapshot.attach_id } } as const;
      for (const event of blobEvents(attach, blob, target, utf8(JSON.stringify(session.snapshot))))
        conn.send(event);
    }
    sendRecords(conn, attach, session, state.mint);
  });
};

const sortedJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

const commandOf = (state: OwnerState, request: SessionCommand): CommandRequest | Outcome => {
  if ("command" in request) return request.command;
  const taken = state.uploads.take(request.upload_id);
  if (taken.kind === "text") return { op: request.op, text: taken.text };
  if (taken.kind === "refused" && taken.reason === "message_too_long") return tooLong();
  return refuse("upload_incomplete", "the upload is not complete");
};

// A command_id binds once to (session, payload sha256): a repeat with the same binding answers the same id and
// dispatches nothing; any other repeat is command_id_conflict.
const command = (state: OwnerState, conn: Conn, request: SessionCommand): Outcome => {
  const session = state.attaches.get(request.attach);
  if (session === undefined || !conn.attaches.has(request.attach))
    return refuse("not_attached", "attach first");
  const resolved = commandOf(state, request);
  if ("reply" in resolved) return resolved;
  if (
    (resolved.op === "prompt" || resolved.op === "steer") &&
    checkCommandText(resolved.text) !== "ok"
  )
    return tooLong();
  const command_id = request.command_id ?? state.mint();
  const binding = {
    target: `${session.device}/${session.session_id}`,
    sha256: sha256Hex(utf8(sortedJson(resolved))),
  };
  const bound = state.bindings.get(command_id);
  if (bound !== undefined && (bound.target !== binding.target || bound.sha256 !== binding.sha256))
    return refuse("command_id_conflict", "the command_id is bound to another session or payload");
  if (bound !== undefined) return ok({ command_id });
  state.bindings.set(command_id, binding);
  state.commands.push(resolved);
  return ok({ command_id }, () => {
    for (const outcome of session.outcome)
      conn.send(eventOf("session.command_state", { command_id, ...outcome }));
  });
};

const part = (state: OwnerState, conn: Conn, request: SessionCommandPart): Outcome => {
  if (!conn.attaches.has(request.attach)) return refuse("not_attached", "attach first");
  const accepted = state.uploads.accept(request);
  if (accepted.kind === "accepted") return ok({ received: request.index });
  const abort = (): void =>
    conn.send(
      eventOf("session.upload_abort", { upload_id: request.upload_id, reason: accepted.reason }),
    );
  const refused =
    accepted.reason === "message_too_long"
      ? tooLong()
      : refuse("invalid_request", "the upload was refused");
  return { ...refused, after: abort };
};

export const sessionHandler = (state: OwnerState, conn: Conn, request: SessionRequest): Outcome => {
  switch (request.type) {
    case "sessions.list":
      return list(state, conn, request);
    case "session.attach":
      return attachTo(state, conn, request);
    case "session.detach":
      if (!conn.attaches.delete(request.attach)) return refuse("not_attached", "no such attach");
      state.attaches.delete(request.attach);
      return ok();
    case "session.command":
      return command(state, conn, request);
    case "session.command_part":
      return part(state, conn, request);
    case "session.read":
      return readPage(state, conn, request);
    default:
      return assertNever(request);
  }
};
