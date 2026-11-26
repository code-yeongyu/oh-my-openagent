import { createHash } from "node:crypto"

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`
}

/** Idempotency fingerprint of a call's arguments: key order and absent fields do not change it. */
export function hashArgs(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}
