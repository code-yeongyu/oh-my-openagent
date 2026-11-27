// The Poly1305 one-time authenticator (RFC 8439 section 2.5), on bigint arithmetic modulo 2^130 - 5.
const P = (1n << 130n) - 5n;
const CLAMP = 0x0ffffffc0ffffffc0ffffffc0fffffffn;
const MASK128 = (1n << 128n) - 1n;

const littleEndian = (bytes: Uint8Array): bigint =>
  bytes.reduceRight((acc, byte) => (acc << 8n) | BigInt(byte), 0n);

export const poly1305 = (key: Uint8Array, message: Uint8Array): Uint8Array => {
  const r = littleEndian(key.subarray(0, 16)) & CLAMP;
  const s = littleEndian(key.subarray(16, 32));
  let h = 0n;
  for (let i = 0; i < message.length; i += 16) {
    const chunk = message.subarray(i, i + 16);
    const padded = littleEndian(chunk) | (1n << BigInt(8 * chunk.length));
    h = ((h + padded) * r) % P;
  }
  let tag = (h + s) & MASK128;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++, tag >>= 8n) out[i] = Number(tag & 0xffn);
  return out;
};
