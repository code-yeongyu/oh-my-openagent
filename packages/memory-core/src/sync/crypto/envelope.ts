import type { SyncEntry } from "./entry.ts"

export type EnvelopeRejection = "bad_envelope" | "batch_with_body"

type Row = { readonly [key: string]: unknown }

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value)

const hasExactly = (value: Row, keys: ReadonlyArray<string>): boolean => {
  const own = Object.keys(value).sort()
  const want = [...keys].sort()
  return own.length === want.length && own.every((key, index) => key === want[index])
}

const isInteger = (value: unknown, min: number): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= min

const isText = (value: unknown): boolean => typeof value === "string" && value.length > 0

const MAX_DEPTH = 64

/** Iterative, so a hostile row nested deeper than any record can be is refused before anything recurses into it. */
const withinDepth = (value: unknown): boolean => {
  const stack: Array<readonly [unknown, number]> = [[value, 1]]
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const [node, depth] = next
    if (typeof node !== "object" || node === null) continue
    if (depth > MAX_DEPTH) return false
    for (const child of Object.values(node)) stack.push([child, depth + 1])
  }
  return true
}

const COMMON = ["seq", "base_seq", "kind", "account", "epoch", "author", "digest", "link", "keyring_link", "record_sig"]

/** The contract's batch id (its `readBatchId`): 16 bytes as unpadded base64url. */
const isBatchId = (value: unknown): boolean => typeof value === "string" && /^[A-Za-z0-9_-]{22}$/.test(value)

const authorHolds = (author: unknown): boolean => {
  if (!isRow(author)) return false
  if (author["kind"] === "device") {
    return hasExactly(author, ["kind", "id", "sealing_public_key", "signing_public_key"]) &&
      isText(author["id"]) && isText(author["sealing_public_key"]) && isText(author["signing_public_key"])
  }
  return author["kind"] === "recovery" && hasExactly(author, ["kind", "credential_id"]) && isText(author["credential_id"])
}

const wrapsHold = (wraps: unknown): boolean =>
  Array.isArray(wraps) &&
  wraps.every((wrap: unknown) => isRow(wrap) && hasExactly(wrap, ["epoch", "id", "wrap"]) && isInteger(wrap["epoch"], 1) && isText(wrap["id"]) && isText(wrap["wrap"]))

/**
 * The closed transport schema of one served chain row (sync-design section 6): exactly the fields
 * of its kind, each of the right shape, before any check reads them. A batch row carrying a body
 * keeps the merged receiver's own code. Everything else that does not match is `bad_envelope`.
 *
 * A batch row may also carry the contract's `batch_id`, which `/v1/sync/entries` served before the
 * service dropped it there. It is checked for shape here and never read: the sealed header's id is
 * bound to the `/v1/sync/batches` row where the object opens (`engine/receive.ts`), and the chain
 * never opens objects. A present `batch_id` that is null or malformed is refused, not ignored.
 */
export const envelopeRefusal = (entry: SyncEntry): EnvelopeRejection | null => {
  const row: unknown = entry
  if (!isRow(row) || !withinDepth(row)) return "bad_envelope"
  const common =
    isInteger(row["seq"], 1) && isInteger(row["base_seq"], 0) && isInteger(row["epoch"], 1) &&
    isText(row["account"]) && isText(row["digest"]) && isText(row["link"]) && isText(row["record_sig"]) && authorHolds(row["author"])
  if (row["kind"] === "batch") {
    if ("body" in row) return "batch_with_body"
    const closed = hasExactly(row, COMMON) || (hasExactly(row, [...COMMON, "batch_id"]) && isBatchId(row["batch_id"]))
    return common && closed && row["keyring_link"] === null ? null : "bad_envelope"
  }
  if (row["kind"] !== "keyring") return "bad_envelope"
  const shaped = hasExactly(row, [...COMMON, "body", "wraps"]) && isText(row["keyring_link"]) && isRow(row["body"]) && wrapsHold(row["wraps"])
  return common && shaped ? null : "bad_envelope"
}
