// Compares one engine method's local answer with its relay answer for the relay parity sweep (#13478): shape and
// values, never timings. Ids, timestamps and other per-call values are replaced by placeholders before comparing.

type Json = unknown
type JsonObject = { readonly [key: string]: unknown }

/** What one leg got back for one record. */
export type Answer =
  /** The engine's own reply record (`type: "response"`). */
  | { readonly kind: "reply"; readonly reply: JsonObject }
  /** Relay only: the final command state, when the host sent no engine reply. */
  | { readonly kind: "outcome"; readonly state: string; readonly reason?: string }
  /** The transport refused the record before any engine saw it (a local API error code). */
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  /** No reply within the leg's wait (records the engine answers with no response, such as a dialog reply). */
  | { readonly kind: "no_reply" }

export type Verdict =
  | { readonly kind: "same" }
  | { readonly kind: "differs"; readonly detail: string }
  | { readonly kind: "missing"; readonly error: string }

// The engine refusals that mean "the relay connection may not run this", not "this record is wrong".
const RELAY_GATE_CODES: ReadonlySet<string> = new Set([
  "delegation_not_granted",
  "delegation_unclassified",
  "delegation_local_only",
  "delegation_malformed",
])

// Transport fields: `id` echoes the request id, `authority` is the role-bound delegated connection's receipt.
const TRANSPORT_KEYS: ReadonlySet<string> = new Set(["id", "authority"])
const VOLATILE_NUMBER =
  /(At|Ms|ms|Time|time|timestamp|Seq|seq|pid|generation|uptime|elapsed|duration|bytes|Bytes|size|count|Count|revision|ordinal|Ordinal)$/
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const LONG_TOKEN = /\b[0-9a-zA-Z_-]{20,}\b/g
// Ids each session mints for itself (entry ids, the leaf, a host's routing handle `rpc-<n>`): two fixture sessions never
// share them, so a value under one of these keys is compared by presence and type only.
const SESSION_MINTED_KEY = /^(id|parentId|leafId|entryId|targetId|sessionId)$/

/** Replaces every alias (fixture ids, paths), timestamp, uuid and long token in `value` with a placeholder. */
function normalize(value: Json, aliases: ReadonlyMap<string, string>, key = ""): Json {
  if (typeof value === "string" && SESSION_MINTED_KEY.test(key) && !aliases.has(value)) return "<minted>"
  if (typeof value === "string") {
    let text = value
    for (const [raw, alias] of aliases) if (raw.length > 0) text = text.split(raw).join(alias)
    return text.replace(ISO_TIME, "<time>").replace(UUID, "<uuid>").replace(LONG_TOKEN, "<token>")
  }
  if (typeof value === "number") return VOLATILE_NUMBER.test(key) ? "<n>" : value
  if (Array.isArray(value)) return value.map((item) => normalize(item, aliases, key))
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => !TRANSPORT_KEYS.has(name))
      .map(([name, item]) => [name, normalize(item, aliases, name)]),
  )
}

/** The first path at which two normalized values differ, with both sides, or undefined when they are equal. */
const isObject = (value: Json): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)

function firstDifference(left: Json, right: Json, path = "$"): string | undefined {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return `${path}: ${left.length} items locally, ${right.length} through the relay`
    for (let index = 0; index < left.length; index++) {
      const found = firstDifference(left[index] ?? null, right[index] ?? null, `${path}[${index}]`)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (isObject(left) && isObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    for (const name of keys) {
      if (!(name in right)) return `${path}.${name}: only locally`
      if (!(name in left)) return `${path}.${name}: only through the relay`
      const found = firstDifference(left[name] ?? null, right[name] ?? null, `${path}.${name}`)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (left === right) return undefined
  const show = (value: Json) => JSON.stringify(value).slice(0, 80)
  return `${path}: ${show(left)} locally, ${show(right)} through the relay`
}

/**
 * The outcomes with which a successful reply reports that it did NOT act, from the engine's typed results:
 * `RpcUnloadAnswer` (rpc-effect-answer-types: "unloaded" | "refused") and `NavigateTreeResult`, `EditAssistantMessageResult`
 * and `EditUserMessageResult` (rpc-result-types: "navigated" | "edited" | "unchanged" | "cancelled"). The types are not
 * exported by @code-yeongyu/senpi, so the set is listed here; every other outcome is a success.
 */
const NOT_APPLIED_OUTCOMES: ReadonlySet<string> = new Set(["refused", "cancelled"])

const unappliedOutcome = (reply: JsonObject): { readonly outcome: string; readonly detail?: string } | undefined => {
  const data = reply["data"]
  if (!isObject(data)) return undefined
  const outcome = data["outcome"]
  if (typeof outcome !== "string" || !NOT_APPLIED_OUTCOMES.has(outcome)) return undefined
  const detail = data["detail"] ?? data["reason"]
  return typeof detail === "string" ? { outcome, detail } : { outcome }
}

/** One short label for an answer, e.g. `reply ok`, `reply unknown_session`, `refused unsupported`. */
export function describe(answer: Answer): string {
  switch (answer.kind) {
    case "reply": {
      const code = answer.reply["errorCode"]
      if (answer.reply["success"] === true) {
        const unapplied = unappliedOutcome(answer.reply)
        if (unapplied === undefined) return "reply ok"
        return `reply ok (outcome ${unapplied.outcome}${unapplied.detail === undefined ? "" : `: ${unapplied.detail}`})`
      }
      return `reply ${typeof code === "string" ? code : JSON.stringify(answer.reply["error"] ?? null).slice(0, 60)}`
    }
    case "outcome":
      return `outcome ${answer.state}${answer.reason === undefined ? "" : ` (${answer.reason})`}`
    case "refused":
      return `refused ${answer.code}`
    case "no_reply":
      return "no reply"
  }
}

const relayGated = (answer: Answer): string | undefined => {
  if (answer.kind === "refused") return answer.code
  if (answer.kind === "outcome" && answer.state !== "engine_applied") return describe(answer).slice("outcome ".length)
  if (answer.kind !== "reply") return undefined
  const code = answer.reply["errorCode"]
  return typeof code === "string" && RELAY_GATE_CODES.has(code) ? code : undefined
}

/**
 * `missing` when the local engine served the record and the relay gate or transport refused it; `same` when both
 * normalized answers are equal (an applied relay command with no reply equals a local record with no reply);
 * `differs` with the first difference otherwise.
 */
export function compareAnswers(local: Answer, relay: Answer, aliases: ReadonlyMap<string, string>): Verdict {
  const gate = relayGated(relay)
  const localServed =
    local.kind === "no_reply" ||
    (local.kind === "reply" && local.reply["success"] === true && unappliedOutcome(local.reply) === undefined)
  if (gate !== undefined && localServed) return { kind: "missing", error: gate }
  if (local.kind === "no_reply" && relay.kind === "outcome" && relay.state === "engine_applied") return { kind: "same" }
  if (local.kind === "reply" && relay.kind === "reply") {
    const found = firstDifference(normalize(local.reply, aliases), normalize(relay.reply, aliases))
    return found === undefined ? { kind: "same" } : { kind: "differs", detail: found }
  }
  if (local.kind === relay.kind && JSON.stringify(local) === JSON.stringify(relay)) return { kind: "same" }
  return { kind: "differs", detail: `${describe(local)} locally, ${describe(relay)} through the relay` }
}
