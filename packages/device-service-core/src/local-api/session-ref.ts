// Vendored from sisyphuslabs/omo-relay-daemon@dab363aa3a9aa51936149d05b416310d429b61e0 packages/local-api/src/session-ref.ts
import {
  ProtoError,
  validateStreamSessionKey,
  validRosterDeviceId,
} from "./spec-proto.ts";

// #393 part B (design C1): a session id is `<device>.<key>`. The key is a stream session key, exactly 22 base64url
// characters with no "."; the device is any well-formed 1..64 string and may hold ".". The split is from the right at
// that fixed width, so the id is unambiguous whatever the device holds. Nobody mints an id: it is formed only from an
// authenticated listing row (device = the envelope sender) whose session_id is a key.
export type SessionRef = Readonly<{ device: string; key: string }>;
const KEY_CHARS = 22;
const MIN_CHARS = KEY_CHARS + 2;
const MAX_CHARS = KEY_CHARS + 65;

export const isStreamSessionKey = (v: unknown): v is string => {
  try {
    validateStreamSessionKey(v);
    return true;
  } catch (error) {
    if (error instanceof ProtoError) return false;
    throw error;
  }
};

export const parseSessionRef = (v: unknown): SessionRef | undefined => {
  if (typeof v !== "string" || !v.isWellFormed()) return undefined;
  if (v.length < MIN_CHARS || v.length > MAX_CHARS || v[v.length - KEY_CHARS - 1] !== ".")
    return undefined;
  const device = v.slice(0, -KEY_CHARS - 1);
  const key = v.slice(-KEY_CHARS);
  return isStreamSessionKey(key) && validRosterDeviceId(device) ? { device, key } : undefined;
};

/** The inverse of parseSessionRef; it refuses (RangeError) anything parse would not return (gate LOW-5). */
export const formatSessionRef = (ref: SessionRef): string => {
  if (!isStreamSessionKey(ref.key) || !validRosterDeviceId(ref.device))
    throw new RangeError("not a session id: the device or the key is malformed");
  return `${ref.device}.${ref.key}`;
};

// Gate MEDIUM-2: an alias (a session title) is refused, and a title of the same shape is never a candidate, when it has
// leading or trailing whitespace or any C0/C1 control character, or when it parses as an id or is a bare key. A pasted
// id or key with a stray newline therefore fails loudly and never resolves by title.
// oxlint-disable-next-line no-control-regex -- the control characters are what this refuses
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
export const ALIAS_MAX_CHARS = 256;
export const unsafeAlias = (s: string): boolean =>
  s !== s.trim() || CONTROL.test(s) || parseSessionRef(s) !== undefined || isStreamSessionKey(s);

/** The one-string tool rule (docs/local-api.md): trim, then a string that parses is a session id, anything else an alias. */
export const sessionTargetOf = (
  text: string,
): { readonly session: string } | { readonly alias: string } => {
  const trimmed = text.trim();
  return parseSessionRef(trimmed) === undefined ? { alias: trimmed } : { session: trimmed };
};
