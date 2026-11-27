// Unkeyed BLAKE2b (RFC 7693) with any digest length up to 64 bytes; node:crypto under Bun only produces the 64-byte digest.
const IV = new BigUint64Array([
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
]);

const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
] as const;

const BLOCK = 128;
const MASK = (1n << 64n) - 1n;

const word = (a: BigUint64Array, i: number): bigint => a[i] ?? 0n;
const rotr = (x: bigint, n: bigint): bigint =>
  ((x >> n) | (x << (64n - n))) & MASK;

const mix = (
  v: BigUint64Array,
  [a, b, c, d]: readonly [number, number, number, number],
  x: bigint,
  y: bigint,
): void => {
  v[a] = word(v, a) + word(v, b) + x;
  v[d] = rotr(word(v, d) ^ word(v, a), 32n);
  v[c] = word(v, c) + word(v, d);
  v[b] = rotr(word(v, b) ^ word(v, c), 24n);
  v[a] = word(v, a) + word(v, b) + y;
  v[d] = rotr(word(v, d) ^ word(v, a), 16n);
  v[c] = word(v, c) + word(v, d);
  v[b] = rotr(word(v, b) ^ word(v, c), 63n);
};

const LANES = [
  [0, 4, 8, 12],
  [1, 5, 9, 13],
  [2, 6, 10, 14],
  [3, 7, 11, 15],
  [0, 5, 10, 15],
  [1, 6, 11, 12],
  [2, 7, 8, 13],
  [3, 4, 9, 14],
] as const;

const compress = (
  h: BigUint64Array,
  block: Uint8Array,
  counter: bigint,
  last: boolean,
): void => {
  const view = new DataView(block.buffer, block.byteOffset, BLOCK);
  const m = BigUint64Array.from({ length: 16 }, (_, i) =>
    view.getBigUint64(i * 8, true),
  );
  const v = new BigUint64Array(16);
  v.set(h);
  v.set(IV, 8);
  v[12] = word(v, 12) ^ (counter & MASK);
  v[13] = word(v, 13) ^ (counter >> 64n);
  if (last) v[14] = word(v, 14) ^ MASK;
  for (let round = 0; round < 12; round++) {
    const s = SIGMA[round % 10] ?? SIGMA[0];
    LANES.forEach((lane, i) =>
      mix(v, lane, word(m, s[2 * i] ?? 0), word(m, s[2 * i + 1] ?? 0)),
    );
  }
  for (let i = 0; i < 8; i++) h[i] = word(h, i) ^ word(v, i) ^ word(v, i + 8);
};

export const blake2b = (data: Uint8Array, outLength: number): Uint8Array => {
  if (!Number.isInteger(outLength) || outLength < 1 || outLength > 64)
    throw new RangeError("BLAKE2b digest length must be 1-64 bytes");
  const h = new BigUint64Array(IV);
  h[0] = word(h, 0) ^ (0x01010000n | BigInt(outLength));
  const blocks = Math.max(1, Math.ceil(data.length / BLOCK));
  for (let i = 0; i < blocks; i++) {
    const block = new Uint8Array(BLOCK);
    const chunk = data.subarray(i * BLOCK, (i + 1) * BLOCK);
    block.set(chunk);
    const last = i === blocks - 1;
    compress(h, block, BigInt(i * BLOCK + chunk.length), last);
  }
  const out = new Uint8Array(64);
  const view = new DataView(out.buffer);
  h.forEach((x, i) => view.setBigUint64(i * 8, x, true));
  return out.slice(0, outLength);
};
