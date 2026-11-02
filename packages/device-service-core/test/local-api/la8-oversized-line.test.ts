import { afterEach, describe, expect, test } from "bun:test";
import { encodeLine, LineDecoder, LOCAL_LINE_MAX } from "../../src/local-api/framing.ts";
import { cleanup, OMO, rawConnect, rawHandshake, startOwner } from "./support.ts";

afterEach(cleanup);

const LF = 0x0a;
const decodeAll = (chunks: readonly Uint8Array[]) => {
  const lines: string[] = [];
  const oversized: number[] = [];
  const decoder = new LineDecoder(
    (line) => lines.push(new TextDecoder().decode(line)),
    (bytes) => oversized.push(bytes),
  );
  for (const chunk of chunks) decoder.push(chunk);
  return { lines, oversized };
};
const filled = (n: number): Uint8Array => new Uint8Array(n).fill(0x61);

describe("LA8 an oversized line resynchronizes", () => {
  test("a line one byte over LOCAL_LINE_MAX is dropped once and the next line decodes", () => {
    const over = filled(LOCAL_LINE_MAX + 1);
    const next = encodeLine({ x: 1 });
    const { lines, oversized } = decodeAll([over, Uint8Array.of(LF), next]);
    expect(oversized).toHaveLength(1);
    expect(lines).toEqual(['{"x":1}']);
  });

  test("a line of exactly LOCAL_LINE_MAX bytes is delivered", () => {
    const { lines, oversized } = decodeAll([filled(LOCAL_LINE_MAX), Uint8Array.of(LF)]);
    expect(oversized).toEqual([]);
    expect(lines[0]).toHaveLength(LOCAL_LINE_MAX);
  });

  test("an oversized line split over many chunks resynchronizes at its LF", () => {
    const chunks = Array.from({ length: 5 }, () => filled(300_000));
    const { lines, oversized } = decodeAll([...chunks, Uint8Array.of(LF, 0x7b, 0x7d, LF)]);
    expect(oversized).toHaveLength(1);
    expect(lines).toEqual(["{}"]);
  });

  test("encodeLine refuses a value whose line would exceed LOCAL_LINE_MAX", () => {
    expect(() => encodeLine({ b: "a".repeat(LOCAL_LINE_MAX) })).toThrow();
  });

  test("the owner drops an oversized line and still answers the next request", async () => {
    const owner = await startOwner();
    const peer = await rawConnect(owner.stateDir);
    await rawHandshake(peer, owner.token, OMO);
    peer.sendBytes(filled(LOCAL_LINE_MAX + 10));
    peer.sendBytes(Uint8Array.of(LF));
    peer.send({ id: "after", type: "status.get" });
    expect(await peer.next()).toMatchObject({ id: "after", ok: true });
    expect(owner.state.log).toEqual(["status.get"]);
  });
});
