// Builds small zip archives for tests: stored or deflated entries with real CRCs.
import { deflateRawSync } from "node:zlib";

export type FixtureEntry = {
  readonly name: string;
  readonly data: string;
  readonly deflate?: boolean;
};

const record = (size: number, fill: (v: DataView) => void): Uint8Array => {
  const out = new Uint8Array(size);
  fill(new DataView(out.buffer));
  return out;
};

export const makeZip = (entries: readonly FixtureEntry[]): Uint8Array => {
  const text = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = text.encode(e.name);
    const data = text.encode(e.data);
    const packed = e.deflate === true ? deflateRawSync(data) : data;
    const method = e.deflate === true ? 8 : 0;
    const crc = Bun.hash.crc32(data);
    const local = record(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x0800, true);
      v.setUint16(8, method, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, packed.length, true);
      v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true);
    });
    central.push(
      record(46, (v) => {
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 20, true);
        v.setUint16(8, 0x0800, true);
        v.setUint16(10, method, true);
        v.setUint32(16, crc, true);
        v.setUint32(20, packed.length, true);
        v.setUint32(24, data.length, true);
        v.setUint16(28, name.length, true);
        v.setUint32(42, offset, true);
      }),
      name,
    );
    parts.push(local, name, packed);
    offset += local.length + name.length + packed.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = record(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, offset, true);
  });
  return new Uint8Array(
    Buffer.concat([...parts, ...central, end].map((p) => Buffer.from(p))),
  );
};
