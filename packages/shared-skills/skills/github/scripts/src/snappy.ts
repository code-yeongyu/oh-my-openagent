// Snappy block-format decompression (github.com/google/snappy format_description.txt), for attestation bundles
// GitHub serves from bundle_url as application/x-snappy. No runtime dependency, so it is decoded here.
import { SurfaceError } from "../vendor/surface/index.ts";

const corrupt = (why: string) =>
  new SurfaceError(
    "invalid_response",
    `snappy data is corrupt: ${why}`,
    "retry; the blob may be truncated",
  );

export const unsnappy = (src: Uint8Array): Uint8Array => {
  let pos = 0;
  const byte = (): number => {
    const b = src[pos++];
    if (b === undefined) throw corrupt("unexpected end");
    return b;
  };
  const littleEndian = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v += byte() * 2 ** (8 * i);
    return v;
  };
  let size = 0;
  for (let shift = 0; ; shift += 7) {
    const b = byte();
    size += (b & 0x7f) * 2 ** shift;
    if (b < 0x80) break;
  }
  const out = new Uint8Array(size);
  let at = 0;
  while (pos < src.length) {
    const tag = byte();
    const kind = tag & 3;
    if (kind === 0) {
      const short = tag >> 2;
      const length = (short < 60 ? short : littleEndian(short - 59)) + 1;
      if (pos + length > src.length || at + length > size)
        throw corrupt("literal overruns");
      out.set(src.subarray(pos, pos + length), at);
      pos += length;
      at += length;
      continue;
    }
    const length = kind === 1 ? ((tag >> 2) & 7) + 4 : (tag >> 2) + 1;
    const offset =
      kind === 1
        ? ((tag >> 5) << 8) | byte()
        : littleEndian(kind === 2 ? 2 : 4);
    if (offset === 0 || offset > at || at + length > size)
      throw corrupt("copy out of range");
    // A copy may overlap its own output (offset < length), so it must go byte by byte.
    for (let i = 0; i < length; i++, at++) out[at] = out[at - offset] ?? 0;
  }
  if (at !== size) throw corrupt("length mismatch");
  return out;
};
