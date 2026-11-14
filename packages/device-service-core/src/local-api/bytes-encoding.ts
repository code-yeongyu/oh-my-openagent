// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/daemon/src/bytes-encoding.ts
// The one byte-encoding helper for code that runs in a browser as well as under Bun (omo-relay-spec decision 0021
// section 3.4: the Buffer call sites on the browser path move here, bytes unchanged). It uses the standard
// Uint8Array encoding methods where the runtime has them and a plain implementation where it does not (they are recent
// in browsers), so callers never depend on Node's Buffer or on a runtime version.

type NativeBytes = Uint8Array & {
  toHex?: () => string;
  toBase64?: (options?: { alphabet?: "base64" | "base64url"; omitPadding?: boolean }) => string;
};
type NativeFrom = {
  fromBase64?: (text: string, options?: { alphabet?: "base64" | "base64url" }) => Uint8Array;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The plain implementations, also run by the parity test so both paths are proven. */
export const portable = {
  hex: (bytes: Uint8Array): string =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
  base64: (bytes: Uint8Array): string => {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
      const n = (a << 16) | (b << 8) | c;
      out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63);
      out += i + 1 < bytes.length ? ALPHABET.charAt((n >> 6) & 63) : "=";
      out += i + 2 < bytes.length ? ALPHABET.charAt(n & 63) : "=";
    }
    return out;
  },
  fromBase64url: (text: string): Uint8Array => {
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(text)) throw new SyntaxError("invalid base64url");
    const clean = text.replaceAll("-", "+").replaceAll("_", "/").replace(/=+$/, "");
    if (clean.length % 4 === 1) throw new SyntaxError("invalid base64url");
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let bits = 0;
    let value = 0;
    let at = 0;
    for (const ch of clean) {
      value = (value << 6) | ALPHABET.indexOf(ch);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (value >> bits) & 255;
      }
    }
    return out;
  },
};

const native = (bytes: Uint8Array): NativeBytes => bytes as NativeBytes;
const from = Uint8Array as unknown as NativeFrom;

export const toHex = (bytes: Uint8Array): string => native(bytes).toHex?.() ?? portable.hex(bytes);

export const toBase64 = (bytes: Uint8Array): string =>
  native(bytes).toBase64?.() ?? portable.base64(bytes);

/** base64url without padding, the form of JWK members and key fingerprints. */
export const toBase64url = (bytes: Uint8Array): string =>
  native(bytes).toBase64?.({ alphabet: "base64url", omitPadding: true }) ??
  portable.base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

export const fromBase64url = (text: string): Uint8Array =>
  from.fromBase64?.(text, { alphabet: "base64url" }) ?? portable.fromBase64url(text);

/** Standard base64 (padded or not); a character outside its alphabet throws, as fromBase64url does for its own. */
export const fromBase64 = (text: string): Uint8Array => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new SyntaxError("invalid base64");
  return (
    from.fromBase64?.(text) ??
    portable.fromBase64url(text.replaceAll("+", "-").replaceAll("/", "_"))
  );
};
