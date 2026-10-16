import { Buffer } from "node:buffer"
import { CanonicalJsonError, type CanonicalJsonValue, type CanonicalJsonViolation } from "./canonical-json-types"
import { canonicalizeJson, compareUtf16, escapeCanonicalString } from "./canonical-json-serialize"

export { CanonicalJsonError, type CanonicalJsonViolation, type CanonicalJsonValue } from "./canonical-json-types"
export { canonicalizeJson } from "./canonical-json-serialize"

/**
 * RFC 8785 (JSON Canonicalization Scheme, JCS) for sync keyring record
 * preimages. A record is signed over its canonical JSON bytes, so the port
 * must prove the bytes it signs are canonical: parse strictly (duplicate keys
 * refused at every depth), re-serialize per RFC 8785 (UTF-16 property order,
 * ECMAScript number serialization, minimal string escapes), and require byte
 * equality with the input. Anything looser (a whitespace heuristic, or
 * `JSON.stringify` of the parsed value) either refuses valid records (spaces
 * inside strings) or signs non-canonical ones (unsorted keys, `1.0`, or
 * duplicate keys a lenient parser silently collapsed into one).
 */

/**
 * A strict JSON tokenizer+parser (not `JSON.parse`): it refuses duplicate
 * object keys at every depth, remembers each token's raw spelling, and
 * classifies the first way the input departs from the canonical form, so a
 * refusal can name the precise RFC 8785 violation instead of a bare mismatch.
 */
/** Deeper documents are refused: no keyring record or snapshot nests anywhere near this. */
export const MAX_CANONICAL_DEPTH = 64

class Parser {
  private position = 0
  private depth = 0
  constructor(private readonly text: string) {}

  parseDocument(): CanonicalJsonValue {
    const value = this.parseValue()
    this.skipInsignificant()
    if (this.position !== this.text.length) throw this.fail("json", "trailing data after the JSON document")
    return value
  }

  private parseValue(): CanonicalJsonValue {
    this.skipInsignificant()
    const char = this.text[this.position]
    if (char === "{" || char === "[") {
      if (this.depth >= MAX_CANONICAL_DEPTH) throw this.fail("json", `nesting deeper than ${MAX_CANONICAL_DEPTH}`)
      this.depth++
      const value = char === "{" ? this.parseObject() : this.parseArray()
      this.depth--
      return value
    }
    if (char === '"') return this.parseString().value
    if (char === "-" || (char >= "0" && char <= "9")) return this.parseNumber()
    for (const [word, literal] of [["null", null], ["true", true], ["false", false]] as const) {
      if (this.text.startsWith(word, this.position)) {
        this.position += word.length
        return literal
      }
    }
    throw this.fail("json", "unexpected token")
  }

  private parseObject(): CanonicalJsonValue {
    this.position++
    const object: { [key: string]: CanonicalJsonValue } = {}
    const keys: string[] = []
    const seen = new Set<string>()
    this.skipInsignificant()
    if (this.text[this.position] === "}") {
      this.position++
      return object
    }
    for (;;) {
      this.skipInsignificant()
      if (this.text[this.position] !== '"') throw this.fail("json", "object keys must be strings")
      const key = this.parseString()
      if (seen.has(key.value)) throw this.fail("duplicate-key", `duplicate property name ${JSON.stringify(key.value)}`)
      seen.add(key.value)
      keys.push(key.value)
      this.skipInsignificant()
      if (this.text[this.position] !== ":") throw this.fail("json", "expected ':' after object key")
      this.position++
      // defineProperty, not assignment: a "__proto__" key must stay an own property.
      Object.defineProperty(object, key.value, { value: this.parseValue(), enumerable: true, writable: true, configurable: true })
      this.skipInsignificant()
      const next = this.text[this.position]
      if (next === ",") {
        this.position++
        continue
      }
      if (next === "}") {
        this.position++
        break
      }
      throw this.fail("json", "expected ',' or '}' in object")
    }
    for (let i = 1; i < keys.length; i++) {
      if (compareUtf16(keys[i - 1], keys[i]) >= 0) {
        throw this.fail("order", `object properties out of order: ${JSON.stringify(keys[i - 1])} precedes ${JSON.stringify(keys[i])}`)
      }
    }
    return object
  }

  private parseArray(): CanonicalJsonValue {
    this.position++
    const array: CanonicalJsonValue[] = []
    this.skipInsignificant()
    if (this.text[this.position] === "]") {
      this.position++
      return array
    }
    for (;;) {
      array.push(this.parseValue())
      this.skipInsignificant()
      const next = this.text[this.position]
      if (next === ",") {
        this.position++
        continue
      }
      if (next === "]") {
        this.position++
        break
      }
      throw this.fail("json", "expected ',' or ']' in array")
    }
    return array
  }

  private parseString(): { value: string; raw: string } {
    const start = this.position
    this.position++
    let value = ""
    for (;;) {
      if (this.position >= this.text.length) throw this.fail("json", "unterminated string")
      const char = this.text[this.position]
      if (char === '"') {
        this.position++
        const raw = this.text.slice(start, this.position)
        if (escapeCanonicalString(value) !== raw) {
          throw this.fail("escape", `string is not minimally escaped: ${raw}`)
        }
        return { value, raw }
      }
      if (char === "\\") {
        const escape = this.text[this.position + 1]
        const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }
        if (escape in simple) {
          value += simple[escape]
          this.position += 2
          continue
        }
        if (escape === "u") {
          const hex = this.text.slice(this.position + 2, this.position + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.fail("json", "invalid \\u escape")
          value += String.fromCharCode(parseInt(hex, 16))
          this.position += 6
          continue
        }
        throw this.fail("json", "invalid escape sequence")
      }
      const code = char.codePointAt(0) ?? 0
      if (code < 0x20) throw this.fail("json", "unescaped control character in string")
      value += char
      this.position++
    }
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.position))
    if (!match) throw this.fail("json", "invalid number")
    const raw = match[0]
    this.position += raw.length
    const value = Number(raw)
    if (!Number.isFinite(value)) throw this.fail("number", `number is not finite: ${raw}`)
    if (JSON.stringify(value) !== raw) throw this.fail("number", `number is not in canonical form: ${raw}`)
    return value
  }

  private skipInsignificant(): void {
    while (this.position < this.text.length && /[\t\n\r ]/.test(this.text[this.position])) {
      throw this.fail("whitespace", "insignificant whitespace between JSON tokens")
    }
  }

  private fail(violation: CanonicalJsonViolation, message: string): CanonicalJsonError {
    return new CanonicalJsonError(violation, `${message} (offset ${this.position})`)
  }
}

/**
 * Validates that `bytes` are RFC 8785 canonical JSON: parses strictly
 * (duplicate keys refused at every depth), re-serializes, and requires byte
 * equality with the input. Throws CanonicalJsonError naming the precise
 * violation on refusal; returns the parsed value on success.
 */
export function requireCanonicalJson(bytes: Uint8Array): CanonicalJsonValue {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new CanonicalJsonError("encoding", "canonical JSON must be valid UTF-8")
  }
  const parsed = new Parser(text).parseDocument()
  const canonical = canonicalizeJson(parsed)
  if (canonical.length !== bytes.length || !Buffer.from(canonical).equals(Buffer.from(bytes))) {
    throw new CanonicalJsonError("json", "input is not byte-identical to its canonical form")
  }
  return parsed
}
