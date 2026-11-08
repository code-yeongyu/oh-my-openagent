import { describe, expect, test } from "bun:test";
import type { LocalEvent } from "../../src/local-api/protocol.ts";
import { validateEvent } from "../../src/local-api/validate.ts";

// relay daemon omo#12719: `session.records` may carry `seqs`, one stream seq per record, increasing within the attach
// (with gaps: the host stream's seqs are not dense). A service sends them only to a client whose version asks for them.
const records = (extra: Record<string, unknown>) => ({ type: "event", kind: "session.records", attach: "a1", attach_id: 2, records: [{ type: "a" }, { type: "b" }], ...extra });

describe("session.records seqs", () => {
  test("records with increasing seqs, gaps included, validate to themselves", () => {
    const event: LocalEvent = { type: "event", kind: "session.records", attach: "a1", attach_id: 2, records: [{ type: "a" }, { type: "b" }], seqs: [4, 11] };
    expect(validateEvent(event)).toEqual(event);
  });

  test.each([
    ["one seq short", [4]],
    ["not increasing", [4, 4]],
    ["zero", [0, 1]],
    ["not a list", 4],
  ])("seqs that are %s are refused", (_name, seqs) => {
    expect(() => validateEvent(records({ seqs }))).toThrow();
  });
});
