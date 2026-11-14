// The vendored local-API client imports these from `@sisyphuslabs/relay-spec/proto` (rewritten to this file, PIN.json
// importRewrites). The whole relay-proto package (cbor-x and thousands of lines) is not needed for them, so each is
// ported here verbatim from sisyphuslabs/omo-relay-spec@8ce4ec71bcb00ca9a0513db5a3aaffadeeec97dc, the commit
// omo-relay-daemon pins in vendor/relay-spec/PIN.json at the commit PIN.json names. Refresh this file with the vendor.

// packages/relay-proto/src/errors.ts
export const RELAY_ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "unregistered",
  "payload_too_large",
  "rate_limited",
  "mailbox_full",
  "stale_target",
  "version_unsupported",
  "internal",
  "shutting_down",
  "entitlement_required",
  // Decision 0017: the account is frozen for a move (a send, retry after retry_after_s) or this object no longer
  // serves it (sent before close 4008).
  "relocating",
] as const;
export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];

export class ProtoError extends Error {
  readonly code: RelayErrorCode;

  constructor(code: RelayErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.name = "ProtoError";
  }
}

// packages/relay-proto/src/session-blob.ts
export const SESSION_BLOB_MAX = 16_777_216;

// packages/relay-proto/src/session-inner.ts
export const SESSION_KIND_MAX_CHARS = 32;
export const SESSION_DEVICE_MAX_CHARS = 64;
export const SESSION_PROJECT_MAX_CHARS = 256;
export const SESSION_ID_MAX_CHARS = 128;

// packages/relay-proto/src/session-read.ts
export const SESSION_READ_TAIL_MAX = 200;

// packages/relay-proto/src/session-summary.ts
export const SESSION_SUMMARY_TITLE_MAX_CHARS = 256;
export const SESSION_SUMMARY_PROJECT_MAX_CHARS = 128;
export const SESSION_SUMMARY_PATH_MAX_CHARS = 1024;

// packages/relay-proto/src/session-codec.ts
const SESSION_KEY_CHARS = 22;
/** Keys that would reach Object.prototype if written into a plain object; refused wherever a key is written. */
const UNSAFE_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];

const sessionFail = (detail: string): never => {
  throw new ProtoError("bad_request", `session payload ${detail}`);
};
const B64URL = /^[A-Za-z0-9_-]+$/;
/** A minted id: exactly `n` base64url characters. */
const base64UrlId = (v: unknown, n: number, detail: string): string =>
  typeof v === "string" && v.length === n && B64URL.test(v) ? v : sessionFail(detail);
const sessionKeyOf = (v: unknown): string =>
  base64UrlId(v, SESSION_KEY_CHARS, "session key");
const safeKey = (key: string, detail: string): string =>
  UNSAFE_KEYS.includes(key) ? sessionFail(detail) : key;

// packages/relay-proto/src/session-stream.ts
export const STREAM_INLINE_MAX = 12_000;
export const validateStreamSessionKey = (v: unknown): string => sessionKeyOf(v);

// packages/relay-proto/src/relay-roster.ts
export const validRosterDeviceId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64 && value.isWellFormed();

// packages/relay-proto/src/session-command.ts
const METHOD = /^(?=.{1,64}$)[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
export const methodOf = (v: unknown, what: string): string => {
  const type = typeof v === "string" && METHOD.test(v) ? v : sessionFail(what);
  // No prototype key may be a method or a segment (a receiver may classify with a plain-object lookup).
  for (const segment of type.split(".")) safeKey(segment, what);
  return type;
};
