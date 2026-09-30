/**
 * Bindings: a session attached to one external conversation thread, connector-neutral. The record
 * shape is closed (every field present, `schema_version: 1`), timestamps are UTC RFC 3339, and
 * `(platform, account_id, chat_id, thread_id)` has at most one `active` binding. Every mutation
 * (bind, unbind, rebind) runs in one store transaction that first applies due expiries; the TTL is
 * never extended. This file holds the pure half: the record type, request validation, and the two
 * opaque codecs (the snapshot cursor of `thread_bindings` and the reply token of a question).
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import type { ExternalAuthor, StoreRefusal } from "./types"

export const BINDING_SCHEMA_VERSION = 1
export const BINDING_PLATFORMS = ["discord", "telegram", "slack", "herdr", "custom"] as const
export const OUTBOUND_EVENTS = ["milestone", "report", "question", "completion"] as const
export const BINDING_STATUSES = ["active", "detached", "expired"] as const
export const INBOUND_MODES = ["auto", "follow_up"] as const
export const COMPLETION_OUTCOMES = ["completed", "failed", "cancelled"] as const

/** One week; `ttl_seconds: null` (no expiry) only when the caller asks for it explicitly. */
export const BINDING_DEFAULT_TTL_SECONDS = 604_800
export const BINDING_MAX_TTL_SECONDS = 366 * 24 * 60 * 60
/** A platform with no threads binds its whole chat under this thread id. */
export const WHOLE_CHAT_THREAD_ID = "@chat"
export const BINDING_DEFAULT_POLICY_ID = "default"
/** Acknowledged outbox rows are kept this long after the ack; unacknowledged rows live as long as their binding. */
export const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const BINDINGS_PAGE_DEFAULT = 50
export const BINDINGS_PAGE_MAX = 200
export const OUTBOX_PAGE_DEFAULT = 100
export const OUTBOX_PAGE_MAX = 500
/** The one relay text cap, in UTF-8 bytes (report text and answers); `relay.ts` enforces it as `message_too_large`. */
export const RELAY_TEXT_MAX_BYTES = 32_768
const IDENTIFIER_MAX_LENGTH = 256

export type BindingPlatform = (typeof BINDING_PLATFORMS)[number]
export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number]
export type BindingStatus = (typeof BINDING_STATUSES)[number]
export type InboundMode = (typeof INBOUND_MODES)[number]
export type CompletionOutcome = (typeof COMPLETION_OUTCOMES)[number]

export type BindingRecord = {
  readonly schema_version: 1
  readonly binding_id: string
  readonly revision: number
  readonly status: BindingStatus
  readonly platform: BindingPlatform
  readonly account_id: string
  readonly chat_id: string
  readonly thread_id: string
  readonly root_message_id: string | null
  readonly progress_message_id: string | null
  readonly session_realm_id: string
  readonly session_durable_id: string
  readonly direction: { readonly inbound: boolean; readonly outbound: boolean }
  readonly inbound_mode: InboundMode
  readonly outbound_events: readonly OutboundEvent[]
  readonly policy_id: string
  readonly created_at: string
  readonly updated_at: string
  readonly lease_started_at: string
  readonly ttl_seconds: number | null
  readonly expires_at: string | null
}

export type BindRequest = {
  readonly platform: BindingPlatform
  readonly account_id: string
  readonly chat_id: string
  readonly thread_id: string
  readonly root_message_id: string | null
  readonly progress_message_id: string | null
  readonly session_durable_id: string
  readonly direction: { readonly inbound: boolean; readonly outbound: boolean }
  readonly inbound_mode: InboundMode
  readonly outbound_events: readonly OutboundEvent[]
  readonly policy_id: string
  readonly ttl_seconds: number | null
}

/** What a caller may leave out of a bind. `ttl_seconds: undefined` means the default; `null` means no expiry. */
export type BindInput = {
  readonly platform: string
  readonly account_id: string
  readonly chat_id: string
  readonly thread_id?: string
  readonly root_message_id?: string | null
  readonly progress_message_id?: string | null
  readonly session_durable_id: string
  readonly direction?: { readonly inbound: boolean; readonly outbound: boolean }
  readonly inbound_mode?: string
  readonly outbound_events?: readonly string[]
  readonly policy_id?: string
  readonly ttl_seconds?: number | null
}

export type RelayOutcome<T> = ({ readonly kind: "ok" } & T) | StoreRefusal

export type OutboxRow = {
  readonly cursor: number
  readonly binding_id: string
  /** The binding revision the row was written under; a connector drops rows of an older revision it no longer serves. */
  readonly revision: number
  readonly event: OutboundEvent
  readonly text: string
  readonly state: "pending" | "acked"
  readonly created_at: string
  /** For a `milestone`: the binding's progress message to edit instead of posting a new one (null until a connector reported one). */
  readonly edit_message_id: string | null
  readonly provider_message_id: string | null
  readonly reply_token: string | null
  readonly question_state: "pending" | "answered" | null
  readonly outcome: CompletionOutcome | null
  /** For an answered `question`: the human the connector named with the answer; null without one. */
  readonly answered_by: ExternalAuthor | null
}

export function rfc3339(ms: number): string {
  return new Date(ms).toISOString()
}

function refusal(message: string): StoreRefusal {
  return { kind: "refused", code: "invalid_arguments", message }
}

function identifier(field: string, value: unknown): string | StoreRefusal {
  if (typeof value !== "string" || value.trim().length === 0) return refusal(`${field} must be a non-empty string.`)
  if (value.length > IDENTIFIER_MAX_LENGTH) return refusal(`${field} is longer than ${IDENTIFIER_MAX_LENGTH} characters.`)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: identifiers are rejected when they carry control characters.
  if (/[\u0000-\u001f\u007f]/.test(value)) return refusal(`${field} carries a control character.`)
  return value
}

function optionalIdentifier(field: string, value: unknown): string | null | StoreRefusal {
  return value === undefined || value === null ? null : identifier(field, value)
}

function isRefusal(value: unknown): value is StoreRefusal {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "refused"
}

export function normalizeBindInput(input: BindInput): BindRequest | StoreRefusal {
  if (!(BINDING_PLATFORMS as readonly string[]).includes(input.platform)) return refusal(`platform must be one of ${BINDING_PLATFORMS.join(", ")}.`)
  const fields = {
    account_id: identifier("account_id", input.account_id),
    chat_id: identifier("chat_id", input.chat_id),
    thread_id: identifier("thread_id", input.thread_id ?? WHOLE_CHAT_THREAD_ID),
    root_message_id: optionalIdentifier("root_message_id", input.root_message_id),
    progress_message_id: optionalIdentifier("progress_message_id", input.progress_message_id),
    session_durable_id: identifier("session", input.session_durable_id),
    policy_id: identifier("policy_id", input.policy_id ?? BINDING_DEFAULT_POLICY_ID),
  }
  for (const value of Object.values(fields)) if (isRefusal(value)) return value
  const direction = input.direction ?? { inbound: true, outbound: true }
  if (direction.inbound !== true && direction.outbound !== true) return refusal("A binding needs at least one direction: inbound, outbound, or both.")
  const inboundMode = input.inbound_mode ?? "auto"
  if (!(INBOUND_MODES as readonly string[]).includes(inboundMode)) return refusal(`inbound_mode must be one of ${INBOUND_MODES.join(", ")}.`)
  const events = input.outbound_events ?? (direction.outbound ? OUTBOUND_EVENTS : [])
  if (events.some((event) => !(OUTBOUND_EVENTS as readonly string[]).includes(event))) return refusal(`outbound_events may only name ${OUTBOUND_EVENTS.join(", ")}.`)
  if (new Set(events).size !== events.length) return refusal("outbound_events must not repeat an event.")
  if (direction.outbound && events.length === 0) return refusal("An outbound binding needs at least one outbound event.")
  const ttl = input.ttl_seconds === undefined ? BINDING_DEFAULT_TTL_SECONDS : input.ttl_seconds
  if (ttl !== null && (!Number.isInteger(ttl) || ttl < 1 || ttl > BINDING_MAX_TTL_SECONDS)) {
    return refusal(`ttl_seconds must be an integer from 1 to ${BINDING_MAX_TTL_SECONDS}, or null for a binding that never expires.`)
  }
  return {
    platform: input.platform as BindingPlatform,
    account_id: fields.account_id as string,
    chat_id: fields.chat_id as string,
    thread_id: fields.thread_id as string,
    root_message_id: fields.root_message_id as string | null,
    progress_message_id: fields.progress_message_id as string | null,
    session_durable_id: fields.session_durable_id as string,
    direction: { inbound: direction.inbound === true, outbound: direction.outbound === true },
    inbound_mode: inboundMode as InboundMode,
    outbound_events: OUTBOUND_EVENTS.filter((event) => events.includes(event)),
    policy_id: fields.policy_id as string,
    ttl_seconds: ttl,
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`
}

/** Idempotency fingerprint of a call's arguments: key order and absent fields do not change it. */
export function hashArgs(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

export function newBindingId(): string {
  return `bnd-${randomUUID()}`
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url")
}

type BindingsCursor = { readonly v: 1; readonly as_of: number; readonly after: readonly [string, string] | null }

/**
 * `thread_bindings` pages over a snapshot: the first page fixes `as_of` (the newest binding row it
 * could see), and later pages list only rows up to it, ordered by `(created_at, binding_id)`, so a
 * bind that lands mid-walk neither shifts nor duplicates a page.
 */
export function encodeBindingsCursor(asOf: number, after: readonly [string, string] | null): string {
  return base64url(JSON.stringify({ v: 1, as_of: asOf, after } satisfies BindingsCursor))
}

export function decodeBindingsCursor(cursor: string): BindingsCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<BindingsCursor>
    if (parsed.v !== 1 || typeof parsed.as_of !== "number" || !Number.isInteger(parsed.as_of)) return null
    const after = parsed.after
    if (after !== null && !(Array.isArray(after) && after.length === 2 && after.every((part) => typeof part === "string"))) return null
    return { v: 1, as_of: parsed.as_of, after: after as readonly [string, string] | null }
  } catch {
    return null
  }
}

/**
 * What a reply token carries: the binding that emitted the question and its revision, the session
 * and its incarnation (the runtime that held it when the question was asked), and the session's
 * real `extension_ui_request` id. The token is `rt1.<payload>.<mac>` with an HMAC under the store's
 * own secret, so no answering side can mint or alter one.
 */
export type ReplyTokenFields = {
  readonly binding_id: string
  readonly revision: number
  readonly session_durable_id: string
  readonly incarnation: string | null
  readonly ui_request_id: string
}

type ReplyTokenPayload = { readonly b: string; readonly r: number; readonly s: string; readonly i: string | null; readonly q: string; readonly n: string }

const REPLY_TOKEN_PREFIX = "rt1"

function mac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`${REPLY_TOKEN_PREFIX}.${payload}`).digest().subarray(0, 16).toString("base64url")
}

export function mintReplyToken(secret: string, fields: ReplyTokenFields): string {
  const payload: ReplyTokenPayload = { b: fields.binding_id, r: fields.revision, s: fields.session_durable_id, i: fields.incarnation, q: fields.ui_request_id, n: randomUUID() }
  const encoded = base64url(JSON.stringify(payload))
  return `${REPLY_TOKEN_PREFIX}.${encoded}.${mac(secret, encoded)}`
}

/** The fields of a token this store minted, or null for anything else (wrong prefix, altered payload, foreign secret). */
export function readReplyToken(secret: string, token: string): ReplyTokenFields | null {
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== REPLY_TOKEN_PREFIX) return null
  const expected = Buffer.from(mac(secret, parts[1]))
  const given = Buffer.from(parts[2])
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Partial<ReplyTokenPayload>
    if (typeof payload.b !== "string" || typeof payload.r !== "number" || typeof payload.s !== "string" || typeof payload.q !== "string") return null
    if (payload.i !== null && typeof payload.i !== "string") return null
    return { binding_id: payload.b, revision: payload.r, session_durable_id: payload.s, incarnation: payload.i ?? null, ui_request_id: payload.q }
  } catch {
    return null
  }
}
