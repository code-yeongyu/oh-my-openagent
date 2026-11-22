import { posix, win32 } from "node:path";
import type { JsonObject, JsonValue } from "./protocol.ts";
import { COMMAND_ID_CHARS } from "./vocabulary.ts";

// Field checks shared by every validator. A failure throws InvalidMessage whose detail names the field, never its
// value, so no refusal can echo a key or a token back.
export const REQUEST_ID_MAX_CHARS = 64;
export const LOCAL_ID_MAX_CHARS = 64;
export const PATH_MAX_CHARS = 4096;
export const LABEL_MAX_CHARS = 256;
export const REASON_MAX_CHARS = 1024;
export const ENTRY_ID_MAX_BYTES = 128;
export const NONCE_CHARS = 43;

export class InvalidMessage extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "InvalidMessage";
    this.detail = detail;
  }
}

export const fail = (detail: string): never => {
  throw new InvalidMessage(detail);
};

export const assertNever = (value: never): never => {
  throw new Error(`unexpected variant ${JSON.stringify(value)}`);
};

export type Fields = { readonly [key: string]: unknown };
export const keysOf = <K extends string>(record: { readonly [P in K]: unknown }): readonly K[] =>
  Object.keys(record).filter((key): key is K => Object.hasOwn(record, key));
export const isRecord = (v: unknown): v is Fields =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const exactly = (
  v: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  what = "message",
): Fields => {
  if (!isRecord(v)) return fail(`${what} must be an object`);
  for (const name of required) if (!Object.hasOwn(v, name)) fail(`${what} misses ${name}`);
  for (const key of Object.keys(v))
    if (!required.includes(key) && !optional.includes(key)) fail(`${what} has an unknown field`);
  return v;
};

export const oneOf = <T extends string>(list: readonly T[], v: unknown, what: string): T =>
  list.find((item) => item === v) ?? fail(what);

export const text = (v: unknown, max: number, what: string, min = 1): string =>
  typeof v === "string" && v.length >= min && v.length <= max && v.isWellFormed() ? v : fail(what);

export const bool = (v: unknown, what: string): boolean =>
  typeof v === "boolean" ? v : fail(what);

export const uint = (v: unknown, min: number, max: number, what: string): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail(what);

const BASE64URL = /^[A-Za-z0-9_-]+$/;
export const localId = (v: unknown, what: string): string =>
  typeof v === "string" && v.length >= 1 && v.length <= LOCAL_ID_MAX_CHARS && BASE64URL.test(v)
    ? v
    : fail(what);

export const commandId = (v: unknown): string =>
  typeof v === "string" && v.length === COMMAND_ID_CHARS && BASE64URL.test(v)
    ? v
    : fail("command_id");

export const nonce = (v: unknown, what: string): string =>
  typeof v === "string" && v.length === NONCE_CHARS && BASE64URL.test(v) ? v : fail(what);

const PRINTABLE = /^[\x21-\x7e]+$/;
export const requestId = (v: unknown): string | undefined =>
  typeof v === "string" && v.length <= REQUEST_ID_MAX_CHARS && PRINTABLE.test(v) ? v : undefined;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export const semver = (v: unknown, what: string): string =>
  typeof v === "string" && v.length <= 64 && SEMVER.test(v) ? v : fail(what);

export const absolutePath = (v: unknown, what: string): string =>
  typeof v === "string" &&
  v.length <= PATH_MAX_CHARS &&
  v.isWellFormed() &&
  !v.includes("\0") &&
  (posix.isAbsolute(v) || win32.isAbsolute(v))
    ? v
    : fail(what);

export const entryId = (v: unknown, what: string): string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.isWellFormed() &&
  new TextEncoder().encode(v).length <= ENTRY_ID_MAX_BYTES
    ? v
    : fail(what);

export const nullable = <T>(v: unknown, check: (value: unknown) => T): T | null =>
  v === null ? null : check(v);

const SHA256_HEX = /^[0-9a-f]{64}$/;
export const sha256Field = (v: unknown, what: string): string =>
  typeof v === "string" && SHA256_HEX.test(v) ? v : fail(what);

// Standard base64 with padding, canonical (it re-encodes to itself), decoding to 1..max bytes.
export const base64Bytes = (v: unknown, max: number, what: string): Uint8Array => {
  if (typeof v !== "string" || v.length === 0 || v.length > 4 * Math.ceil(max / 3))
    return fail(what);
  const bytes = Buffer.from(v, "base64");
  return bytes.length <= max && bytes.toString("base64") === v ? new Uint8Array(bytes) : fail(what);
};

const UNSAFE_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];
export const safeKey = (key: string, what: string): string =>
  UNSAFE_KEYS.includes(key) ? fail(what) : key;

export const jsonValue = (v: unknown, what: string): JsonValue => {
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : fail(what);
  if (Array.isArray(v)) return v.map((item) => jsonValue(item, what));
  if (isRecord(v)) return jsonObject(v, what);
  return fail(what);
};

export const jsonObject = (v: unknown, what: string): JsonObject => {
  if (!isRecord(v)) return fail(what);
  const out: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(v)) out[key] = jsonValue(item, what);
  return out;
};
