import { describe, expect, test } from "bun:test";
import { LOCAL_INLINE_MAX } from "../../src/local-api/limits.ts";
import { validateEvent, validateRequest, validateResponse } from "../../src/local-api/validate.ts";

// DLG10 (DS2b 2a, decision 0018 section 3): the local API half of the delegated channel. A client opts a command into
// the viewer client's own delegated connection with `delegated: true`, or addresses a host engine endpoint by its key
// (`endpoint`, learned from session.endpoints); the engine's unsolicited frames and the replies of its delegated
// commands come back as session.command_event (inline, or as a blob of command_blob_chunk parts), and a lost or
// reset channel ends with session.channel_closed, which the client treats as a socket close.
const KEY = "RVBFUEVQRVBFUEVQRVBFUA";
const PEER = "dev-peer";
const SHA = "ab".repeat(32);
const ok = (v: unknown) => {
  const verdict = validateRequest(v);
  if (!verdict.ok) throw new Error(`refused: ${verdict.reason}`);
  return verdict.request;
};

describe("DLG10 the local API carries delegated commands, endpoint keys and the command channel", () => {
  test("session.command takes delegated: true or an endpoint key; anything else is refused", () => {
    const base = {
      id: "r1",
      type: "session.command",
      attach: "a1",
      rpc: { type: "zz_new" },
    } as const;
    expect(ok({ ...base, delegated: true })).toEqual({ ...base, delegated: true });
    expect(ok({ ...base, endpoint: KEY })).toEqual({ ...base, endpoint: KEY });
    expect(ok(base)).toEqual(base);
    const toDevice = { id: "r1", type: "session.command", device: PEER, endpoint: KEY, rpc: { type: "open_session" } } as const;
    expect(ok({ ...toDevice, locate: true })).toEqual({ ...toDevice, locate: true });
    expect(validateRequest({ ...toDevice, locate: false }).ok).toBe(false);
    for (const bad of [
      { ...base, delegated: false },
      { ...base, endpoint: "short" },
      { ...base, endpoint: `${KEY.slice(0, 21)}+` },
    ])
      expect(validateRequest(bad).ok).toBe(false);
  });

  test("session.endpoints names a device and answers at most 16 distinct keys", () => {
    expect(ok({ id: "r2", type: "session.endpoints", device: PEER }) as unknown).toEqual({
      id: "r2",
      type: "session.endpoints",
      device: PEER,
    });
    const reply = (endpoints: unknown) => ({
      id: "r2",
      type: "response",
      ok: true,
      data: { endpoints },
    });
    expect(validateResponse(reply([KEY]), "session.endpoints")).toEqual({
      id: "r2",
      ok: true,
      data: { endpoints: [KEY] },
    });
    expect(() => validateResponse(reply([KEY, KEY]), "session.endpoints")).toThrow();
    expect(() =>
      validateResponse(reply(Array.from({ length: 17 }, () => KEY)), "session.endpoints"),
    ).toThrow();
  });

  test("command_event: a frame, a reply, or a blob of one; blob chunks and done; channel_closed", () => {
    const head = { type: "event", kind: "session.command_event", device: PEER } as const;
    const valid = [
      { ...head, frame: { type: "session_status", sessionId: "rpc-1" } },
      { ...head, command_id: "Y29tbWFuZC1pZC0wMDAwMQ", response: { success: true } },
      // Decision 0018 amendment 2026-11-06: an open that asked names its new session beside the reply.
      { ...head, command_id: "Y29tbWFuZC1pZC0wMDAwMQ", response: { success: true }, located: { key: KEY, session: `${PEER}.${KEY}` } },
      { ...head, blob: { id: "b1", bytes: 3, sha256: SHA } },
      { type: "event", kind: "session.command_blob_chunk", id: "b1", off: 0, b: "YWJj" },
      { type: "event", kind: "session.command_blob_done", id: "b1" },
      { type: "event", kind: "session.channel_closed", device: PEER, reason: "event_gap" },
      { type: "event", kind: "session.channel_closed", device: PEER, reason: "event_overflow" },
    ];
    for (const event of valid) expect(validateEvent(event) as unknown).toEqual(event);
    const invalid = [
      { ...head },
      { ...head, frame: {}, response: {} },
      { ...head, response: { success: true } },
      { ...head, command_id: "Y29tbWFuZC1pZC0wMDAwMQ", response: {}, located: { key: KEY, session: `other.${KEY}` } },
      { ...head, command_id: "Y29tbWFuZC1pZC0wMDAwMQ", response: {}, located: { key: "short", session: `${PEER}.short` } },
      { ...head, command_id: "Y29tbWFuZC1pZC0wMDAwMQ", response: {}, located: { key: KEY } },
      { ...head, frame: { big: "x".repeat(LOCAL_INLINE_MAX) } },
      { type: "event", kind: "session.channel_closed", device: PEER, reason: "bored" },
    ];
    for (const event of invalid) expect(() => validateEvent(event)).toThrow();
  });
});
