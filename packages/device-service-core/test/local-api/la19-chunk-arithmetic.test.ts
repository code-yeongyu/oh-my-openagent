import { SESSION_COMMAND_TEXT_MAX_BYTES, SESSION_BLOB_MAX } from "../../src/local-api/spec-proto.ts";
import { describe, expect, test } from "bun:test";
import { LOCAL_BLOB_MAX, LOCAL_CHUNK_MAX, LOCAL_INLINE_MAX, lineBytes } from "../../src/local-api/chunking.ts";
import { LOCAL_LINE_MAX } from "../../src/local-api/framing.ts";
import { LOCAL_UPLOAD_PARTS_MAX } from "../../src/local-api/upload.ts";
import { validateEvent, validateRequest } from "../../src/local-api/validate.ts";
import { LOCAL_ID_MAX_CHARS, REQUEST_ID_MAX_CHARS } from "../../src/local-api/validate-fields.ts";

const longest = (n: number): string => "x".repeat(n);
const echoed = (event: unknown): unknown => validateEvent(event);
const fullChunk = Buffer.alloc(LOCAL_CHUNK_MAX, 0xff).toString("base64");

describe("LA19 chunk arithmetic", () => {
  test("a full chunk is 349,528 base64 characters and the part count covers the byte limit", () => {
    expect(fullChunk.length).toBe(4 * Math.ceil(LOCAL_CHUNK_MAX / 3));
    expect(fullChunk.length).toBe(349_528);
    expect(LOCAL_UPLOAD_PARTS_MAX * LOCAL_CHUNK_MAX).toBeGreaterThanOrEqual(
      SESSION_COMMAND_TEXT_MAX_BYTES,
    );
    expect((LOCAL_UPLOAD_PARTS_MAX - 1) * LOCAL_CHUNK_MAX).toBeLessThan(
      SESSION_COMMAND_TEXT_MAX_BYTES,
    );
    expect(LOCAL_BLOB_MAX).toBe(6 * SESSION_BLOB_MAX);
  });

  test("the largest session.blob_chunk and session.command_part lines are under LOCAL_LINE_MAX", () => {
    const chunk = {
      type: "event",
      kind: "session.blob_chunk",
      attach: longest(LOCAL_ID_MAX_CHARS),
      id: longest(LOCAL_ID_MAX_CHARS),
      off: LOCAL_BLOB_MAX - LOCAL_CHUNK_MAX,
      b: fullChunk,
    };
    const part = {
      id: longest(REQUEST_ID_MAX_CHARS),
      type: "session.command_part",
      attach: longest(LOCAL_ID_MAX_CHARS),
      upload_id: longest(LOCAL_ID_MAX_CHARS),
      index: LOCAL_UPLOAD_PARTS_MAX - 1,
      count: LOCAL_UPLOAD_PARTS_MAX,
      b: fullChunk,
    };
    expect(echoed(chunk)).toEqual(chunk);
    expect(validateRequest(part)).toMatchObject({ ok: true });
    const chunkLine = lineBytes(chunk);
    const partLine = lineBytes(part);
    console.log(
      `blob_chunk_line=${chunkLine} command_part_line=${partLine} line_max=${LOCAL_LINE_MAX}`,
    );
    expect(chunkLine).toBeLessThan(LOCAL_LINE_MAX);
    expect(partLine).toBeLessThan(LOCAL_LINE_MAX);
    expect(Math.max(chunkLine, partLine)).toBeLessThanOrEqual(LOCAL_INLINE_MAX);
  });

  test("one byte over LOCAL_CHUNK_MAX is refused in both directions", () => {
    const over = Buffer.alloc(LOCAL_CHUNK_MAX + 1).toString("base64");
    expect(() =>
      validateEvent({
        type: "event",
        kind: "session.blob_chunk",
        attach: "a",
        id: "b",
        off: 0,
        b: over,
      }),
    ).toThrow();
    const part = {
      id: "1",
      type: "session.command_part",
      attach: "a",
      upload_id: "u",
      index: 0,
      count: 1,
      b: over,
    };
    expect(validateRequest(part)).toMatchObject({ ok: false, code: "invalid_request" });
  });
});
