import { CANARIES } from "./account-canaries.test-support"

// The non-disclosure scanner (security design section 6): every own key of a surface (string and symbol), the entries
// of a Map and a Set, the bytes of a buffer read as text, an error's message, stack and cause; a canary counts as
// leaked in its plain form, in base64, base64url or hex, or as a 16-character prefix.

function bytesText(value: ArrayBufferView | ArrayBuffer): string {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
}

function surfaceText(value: unknown, seen = new Set<unknown>()): string {
  if (typeof value === "symbol") return value.description ?? ""
  if (value === null || typeof value !== "object") return String(value)
  if (seen.has(value)) return ""
  seen.add(value)
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return bytesText(value)
  const parts: string[] = []
  if (value instanceof Map)
    for (const [key, entry] of value) parts.push(`${surfaceText(key, seen)}=${surfaceText(entry, seen)}`)
  if (value instanceof Set) for (const entry of value) parts.push(surfaceText(entry, seen))
  if (value instanceof Error) parts.push(value.message, value.stack ?? "")
  for (const key of Reflect.ownKeys(value))
    parts.push(`${surfaceText(key, seen)}=${surfaceText(Reflect.get(value, key), seen)}`)
  return parts.join("\n")
}

const forms = (canary: string): string[] => {
  const bytes = Buffer.from(canary, "utf8")
  return [
    canary,
    bytes.toString("base64").replace(/=+$/, ""),
    bytes.toString("base64url"),
    bytes.toString("hex"),
    canary.slice(0, 16),
  ]
}

/** The names of the canaries any of `surfaces` holds, in any of the forms above. */
export function leaked(surfaces: readonly unknown[], secrets: Readonly<Record<string, string>> = CANARIES): string[] {
  const text = surfaces.map((surface) => surfaceText(surface)).join("\n")
  return Object.entries(secrets)
    .filter(([, canary]) => forms(canary).some((form) => text.includes(form)))
    .map(([name]) => name)
}
