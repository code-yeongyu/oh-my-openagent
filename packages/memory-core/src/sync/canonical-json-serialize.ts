import { Buffer } from "node:buffer"
import { CanonicalJsonError, type CanonicalJsonValue } from "./canonical-json-types"

/** RFC 8785 §3.2.2.2: only " \\ and the five named control escapes are allowed; every other control character is a lowercase \u00XX. */
export function escapeCanonicalString(value: string): string {
  let out = '"'
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (char === '"') out += '\\"'
    else if (char === "\\") out += "\\\\"
    else if (char === "\b") out += "\\b"
    else if (char === "\t") out += "\\t"
    else if (char === "\n") out += "\\n"
    else if (char === "\f") out += "\\f"
    else if (char === "\r") out += "\\r"
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0")
    else if (code >= 0xd800 && code <= 0xdfff) throw new CanonicalJsonError("encoding", "lone surrogate in string")
    else out += char
  }
  return out + '"'
}

/** RFC 8785 §3.2.3: property names sort as arrays of UTF-16 code units, unsigned. */
export function compareUtf16(left: string, right: string): number {
  const a = Buffer.from(left, "utf16le").swap16()
  const b = Buffer.from(right, "utf16le").swap16()
  return Buffer.compare(a, b)
}

const MAX_SERIALIZE_DEPTH = 64

function serializeValue(value: CanonicalJsonValue, out: string[], depth = 0): void {
  if (typeof value === "object" && value !== null && depth >= MAX_SERIALIZE_DEPTH) {
    throw new CanonicalJsonError("json", `nesting deeper than ${MAX_SERIALIZE_DEPTH}`)
  }
  if (value === null) out.push("null")
  else if (typeof value === "boolean") out.push(value ? "true" : "false")
  else if (typeof value === "number") out.push(JSON.stringify(value))
  else if (typeof value === "string") out.push(escapeCanonicalString(value))
  else if (Array.isArray(value)) {
    out.push("[")
    value.forEach((element, index) => {
      if (index > 0) out.push(",")
      serializeValue(element, out, depth + 1)
    })
    out.push("]")
  } else {
    out.push("{")
    Object.keys(value)
      .sort(compareUtf16)
      .forEach((key, index) => {
        if (index > 0) out.push(",")
        out.push(escapeCanonicalString(key), ":")
        serializeValue(value[key], out, depth + 1)
      })
    out.push("}")
  }
}

/** Serializes a parsed value to its RFC 8785 canonical form (UTF-8 bytes). */
export function canonicalizeJson(value: CanonicalJsonValue): Uint8Array {
  const out: string[] = []
  serializeValue(value, out)
  return new TextEncoder().encode(out.join(""))
}
