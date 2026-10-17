/**
 * RFC 8785 canonical JSON, base64url and SHA-256 helpers shared by every sync-format module.
 * WebCrypto only; runs in Bun, workerd, Node and Electron. The protocol's value domain is
 * ASCII strings, booleans, null, integers 0..2^53-1, arrays and plain objects; numbers outside
 * that domain are refused so a preimage never depends on float formatting.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

export class SyncFormatError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "SyncFormatError";
    this.reason = reason;
  }
}

const canonicalNumber = (value: number): string => {
  if (!Number.isSafeInteger(value)) {
    throw new SyncFormatError("bad_integer", `not a bounded integer: ${String(value)}`);
  }
  return JSON.stringify(value);
};

/** Serializes one value as RFC 8785 canonical JSON: sorted keys, no whitespace, UTF-8 text. */
export const jcsCanonical = (value: JsonValue): string => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return jcsArray(value);
  return jcsRecord(value);
};

const jcsArray = (items: ReadonlyArray<JsonValue>): string =>
  `[${items.map((item) => jcsCanonical(item)).join(",")}]`;

const jcsRecord = (value: object): string => {
  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      const item: JsonValue = Reflect.get(value, key);
      return `${JSON.stringify(key)}:${jcsCanonical(item)}`;
    });
  return `{${entries.join(",")}}`;
};

/** UTF-8 bytes of a canonical JSON value: the bytes every preimage and digest covers. */
export const jcsBytes = (value: JsonValue): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(jcsCanonical(value));

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url (RFC 4648 section 5), the protocol's one binary encoding. */
export const b64urlEncode = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64_ALPHABET[a >> 2] ?? "";
    out += B64_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)] ?? "";
    if (b !== undefined) out += B64_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)] ?? "";
    if (c !== undefined) out += B64_ALPHABET[c & 0x3f] ?? "";
  }
  return out;
};

/**
 * Decodes canonical unpadded base64url; padding, whitespace, foreign characters, an impossible
 * length (mod 4 = 1) and nonzero trailing bits (a noncanonical encoding) are all refused.
 */
export const b64urlDecode = (text: string): Uint8Array<ArrayBuffer> => {
  if (text.length === 0 || text.includes("=") || text.length % 4 === 1) {
    throw new SyncFormatError("bad_base64url", "expected nonempty unpadded base64url");
  }
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of text) {
    const value = B64_ALPHABET.indexOf(ch);
    if (value === -1) {
      throw new SyncFormatError("bad_base64url", `foreign character: ${ch}`);
    }
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) {
    throw new SyncFormatError("bad_base64url", "nonzero trailing bits: not canonical");
  }
  return new Uint8Array(bytes);
};

export const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

export const sha256B64 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  b64urlEncode(await sha256(bytes));

/** Concatenates byte strings without Buffer (workerd has none). */
export const concatBytes = (parts: ReadonlyArray<Uint8Array>): Uint8Array<ArrayBuffer> => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export const asciiBytes = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array([...text].map((ch) => ch.charCodeAt(0) & 0x7f));
