import { blobEvents, LOCAL_INLINE_MAX, lineBytes, sha256Hex } from "../../../src/local-api/chunking.ts";
import type { ReadEntry, SessionRead } from "../../../src/local-api/protocol.ts";
import {
  type Conn,
  eventOf,
  ok,
  type Outcome,
  type OwnerState,
  refuse,
  utf8,
} from "./fake-owner-state.ts";

// A history page: entries inline while the read_result line fits LOCAL_INLINE_MAX, every other entry as an
// entry_ref followed (after the read_result) by its blob, or by a too_large abort when the world marks it too large.
export const readPage = (state: OwnerState, conn: Conn, request: SessionRead): Outcome => {
  const session = state.attaches.get(request.attach);
  if (session === undefined || !conn.attaches.has(request.attach))
    return refuse("not_attached", "attach first");
  const before = request.before_entry_id ?? null;
  const page = session.pages.find((p) => p.before_entry_id === before) ?? {
    entries: [],
    next_before: null,
  };
  const query_id = state.mint();
  const { attach } = request;
  return ok({ query_id }, () => {
    const entries: ReadEntry[] = [];
    const later: (() => void)[] = [];
    for (const entry of page.entries) {
      if ("too_large" in entry) {
        const { entry_id, bytes } = entry;
        entries.push({ kind: "entry_ref", entry_id, bytes, sha256: sha256Hex(utf8(entry_id)) });
        const abort = { attach, id: state.mint(), reason: "too_large", query_id, entry_id };
        later.push(() => conn.send(eventOf("session.blob_abort", abort)));
        continue;
      }
      const inline: ReadEntry = { kind: "entry", entry_id: entry.entry_id, entry: entry.entry };
      const draft = {
        attach,
        query_id,
        entries: [...entries, inline],
        next_before: page.next_before,
      };
      if (lineBytes(eventOf("session.read_result", draft)) <= LOCAL_INLINE_MAX) {
        entries.push(inline);
        continue;
      }
      const data = utf8(JSON.stringify(entry.entry));
      entries.push({
        kind: "entry_ref",
        entry_id: entry.entry_id,
        bytes: data.length,
        sha256: sha256Hex(data),
      });
      const target = { of: "entry", position: { query_id, entry_id: entry.entry_id } } as const;
      later.push(() => {
        for (const event of blobEvents(attach, state.mint(), target, data)) conn.send(event);
      });
    }
    conn.send(
      eventOf("session.read_result", { attach, query_id, entries, next_before: page.next_before }),
    );
    for (const send of later) send();
  });
};
