// The Salsa20 core, HSalsa20 key derivation and the XSalsa20 stream cipher (24-byte nonce), as NaCl's crypto_box uses them.
const SIGMA = new TextEncoder().encode("expand 32-byte k");

const word = (x: Uint32Array, i: number): number => x[i] ?? 0;
const rotl = (v: number, n: number): number => (v << n) | (v >>> (32 - n));

const quarter = (
  x: Uint32Array,
  a: number,
  b: number,
  c: number,
  d: number,
) => {
  x[b] = word(x, b) ^ rotl((word(x, a) + word(x, d)) | 0, 7);
  x[c] = word(x, c) ^ rotl((word(x, b) + word(x, a)) | 0, 9);
  x[d] = word(x, d) ^ rotl((word(x, c) + word(x, b)) | 0, 13);
  x[a] = word(x, a) ^ rotl((word(x, d) + word(x, c)) | 0, 18);
};

const ROUNDS = [
  [0, 4, 8, 12],
  [5, 9, 13, 1],
  [10, 14, 2, 6],
  [15, 3, 7, 11],
  [0, 1, 2, 3],
  [5, 6, 7, 4],
  [10, 11, 8, 9],
  [15, 12, 13, 14],
] as const;

const words = (bytes: Uint8Array): Uint32Array => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint32Array.from({ length: bytes.length / 4 }, (_, i) =>
    view.getUint32(i * 4, true),
  );
};

const bytesOf = (w: Uint32Array): Uint8Array => {
  const out = new Uint8Array(w.length * 4);
  const view = new DataView(out.buffer);
  w.forEach((v, i) => view.setUint32(i * 4, v, true));
  return out;
};

const initial = (key: Uint8Array, input: Uint8Array): Uint32Array => {
  const [c, k, n] = [words(SIGMA), words(key), words(input)];
  return Uint32Array.of(
    word(c, 0),
    ...k.subarray(0, 4),
    word(c, 1),
    ...n,
    word(c, 2),
    ...k.subarray(4, 8),
    word(c, 3),
  );
};

const permute = (state: Uint32Array): Uint32Array => {
  const x = state.slice();
  for (let i = 0; i < 10; i++)
    for (const [a, b, c, d] of ROUNDS) quarter(x, a, b, c, d);
  return x;
};

/** Salsa20 block for a 32-byte key and a 16-byte input (8-byte nonce, then a little-endian 64-bit counter). */
const block = (key: Uint8Array, input: Uint8Array): Uint8Array => {
  const state = initial(key, input);
  const x = permute(state);
  return bytesOf(x.map((v, i) => v + word(state, i)));
};

export const hsalsa20 = (key: Uint8Array, input: Uint8Array): Uint8Array => {
  const x = permute(initial(key, input));
  return bytesOf(
    Uint32Array.from([0, 5, 10, 15, 6, 7, 8, 9], (i) => word(x, i)),
  );
};

/** XOR `data` with the XSalsa20 keystream for a 32-byte key and a 24-byte nonce, starting at block 0. */
export const xsalsa20 = (
  key: Uint8Array,
  nonce: Uint8Array,
  data: Uint8Array,
): Uint8Array => {
  const subkey = hsalsa20(key, nonce.subarray(0, 16));
  const input = new Uint8Array(16);
  input.set(nonce.subarray(16, 24));
  const counter = new DataView(input.buffer);
  const out = new Uint8Array(data.length);
  for (let offset = 0, n = 0; offset < data.length; offset += 64, n++) {
    counter.setBigUint64(8, BigInt(n), true);
    const stream = block(subkey, input);
    for (let i = 0; i < 64 && offset + i < data.length; i++)
      out[offset + i] = (data[offset + i] ?? 0) ^ (stream[i] ?? 0);
  }
  return out;
};
